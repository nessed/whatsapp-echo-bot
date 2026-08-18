# How the WhatsApp → DeepSeek Assistant Works

A complete explanation of a working WhatsApp AI assistant, built in n8n.

This document explains **why each piece exists**, not how to type it. If you
understand everything here, you understand the system well enough to rebuild
it, debug it, or extend it.

---

## Part 1 — What this thing actually is

A WhatsApp phone number that answers questions using an AI model, and
remembers the conversation.

You text it. A few seconds later it texts back, with an answer that takes
into account what you said earlier in the conversation.

That's the whole product. Everything below is the machinery that makes those
two sentences true and keeps them true when things go wrong.

### Why it's more complicated than it sounds

The naive version is three steps: get message, ask AI, send reply. A real
version has to handle all of this:

- WhatsApp sometimes **delivers the same message twice**. Reply twice and you
  look broken.
- WhatsApp sends you **far more than messages** — delivery receipts, read
  receipts, account updates. Most incoming traffic is not a message at all.
- People send **images, voice notes, stickers**. An AI text model can't read
  those.
- **Anyone who finds your webhook URL can POST fake messages at it.**
- The AI needs **conversation history** to answer follow-up questions, but
  you can't send it everything forever — it costs money per word and has a
  size limit.
- **Meta requires a reply within seconds**, but the AI takes longer than that
  to think.
- When something fails halfway through, you need to know **which half**.

Every node in this workflow exists because of one of those problems.

---

## Part 2 — The cast

Five separate systems. Each does one job.

### Meta / WhatsApp Cloud API
Meta owns WhatsApp. They provide an API so businesses can send and receive
messages programmatically. You get a test phone number. Meta sends incoming
messages to a URL you nominate, and you send outgoing messages by making an
HTTP request to Meta.

### n8n
A workflow automation tool. You build a flowchart of "nodes" — each node does
one thing (make an HTTP request, check a condition, transform data) and passes
its result to the next node. It's the orchestrator: the thing that decides
what happens in what order.

Runs on your own laptop in this project.

### ngrok
Meta will only send webhooks to a public HTTPS address. Your laptop doesn't
have one. ngrok creates a public URL that tunnels straight to your machine.

Think of it as a temporary public front door to a computer that doesn't
normally have one.

### Supabase
A hosted Postgres database. Two tables here:

- **`messages`** — every message in both directions, inbound and outbound
- **`assistant_runs`** — one row per AI attempt, used to prevent double-replies
  and to record what happened

### DeepSeek
The AI model that writes the replies. You send it a conversation, it sends
back the next thing to say.

---

## Part 3 — Four concepts you need before the walkthrough

### 3.1 A webhook is a phone number you give out

Normally your program asks a server for data. A webhook inverts that: you
tell someone else's server "here's my address, call me when something
happens."

Meta doesn't hold messages for you to collect. The instant someone texts your
number, Meta makes an HTTP POST to your URL with the message inside. If your
server is down, that message is delayed or lost.

**This is why n8n and ngrok have to be running.** Turn off your laptop and
the bot doesn't "queue up" messages — it simply isn't there when Meta calls.

### 3.2 Idempotency — doing something once, even if asked twice

Networks are unreliable. Meta may send the same message to your webhook more
than once — because their first attempt timed out, or was retried, or for
reasons you'll never see.

If you naively reply to every delivery, a user who sent one message gets two
answers. Worse, you pay the AI twice.

**Idempotency** means: no matter how many times the same request arrives, the
effect happens exactly once. This system achieves it twice over — once in the
database, once with a dedicated "claim" step. Both are explained below.

### 3.3 The context window — why the AI needs history, and why it's limited

An AI model has no memory between requests. Each call is a blank slate. If you
ask "what's the capital of France?" then "what's its population?", the second
question is meaningless on its own.

The fix is to resend the whole conversation every time:

```
You:  what's the capital of France?
Bot:  Paris.
You:  what's its population?
```

The model reads all of that and answers correctly.

But you're charged per word sent, and there's a maximum size. So you send a
**bounded** amount of history — recent messages only, not everything ever.
This system sends the last 10.

**Critical consequence:** the bot can only remember what was *written down*.
If you never save the bot's own replies to the database, then next time you
only send it your own messages, and it has no idea what it said.

### 3.4 The 24-hour window — a WhatsApp business rule

Meta doesn't let businesses message people freely. The rule:

- If a user messages you, a **24-hour window** opens. Inside that window you
  can send whatever you like.
- Outside that window, you can only send **pre-approved templates**.

The trap: if you send a free-form message outside the window, Meta returns a
perfectly normal success response with a valid message ID — **and silently
never delivers it.** No error. You have to know this rule exists, because the
API won't tell you that you broke it.

For this project it barely matters, because you always message first. For a
bot that contacts customers first, it's the central design constraint.

---

## Part 4 — The journey of one message

Follow a single text from your thumb to the reply on your screen.

### Step 1 — You send "what's the capital of France?"

Your phone sends it to WhatsApp. Normal WhatsApp.

### Step 2 — Meta calls the webhook

Meta packages the message into a JSON document and POSTs it to the ngrok URL.
The payload is deeply nested — the actual text sits about six levels down,
wrapped in metadata about the business account, the phone number, the contact.

### Step 3 — ngrok forwards it to n8n

Straight through the tunnel to the laptop.

### Step 4 — n8n decides: is this actually a message?

Most of what Meta sends is *not* a message. Delivery receipts and read
receipts arrive at the same URL, in the same shape, with a different key
inside. So the first thing the workflow does is check whether there's a real
message in there. If not, it says "OK" and stops.

### Step 5 — Pull out the five things that matter

The raw payload is unwieldy. One node extracts exactly what's needed: who
sent it, what it says, its unique ID, when it was sent, what type it is.

### Step 6 — Write it to the database immediately

Before doing anything clever, the message is saved. Two reasons: it becomes
part of the conversation history for later, and if everything downstream
explodes you still have a record of what came in.

### Step 7 — Tell Meta "got it"

The workflow replies 200 OK to Meta **now**, before the AI has been called.

This is deliberate and important. Meta expects a fast acknowledgement. The AI
takes several seconds. If you made Meta wait for the AI, Meta would time out
and start retrying — which means duplicate messages, which is the exact
problem you're trying to avoid.

So: acknowledge fast, keep working afterwards.

### Step 8 — Two security-ish checks

Is this from the one allowed phone number? If not, stop.

Is it text? If it's an image or a voice note, send a fixed "I only handle
text" reply and stop — don't call the AI.

### Step 9 — Claim the message

Try to insert a row into `assistant_runs` keyed on this message's unique ID.

- If the insert succeeds, this is the first time we've seen this message.
  Proceed.
- If a row already exists, we've handled this before. Stop silently.

This is the double-reply guard. Even if Meta delivers the same message five
times, only the first one gets past this point.

### Step 10 — Fetch recent conversation history

Query the database for the last 10 messages with this person, newest first.

### Step 11 — Build the AI request

Flip the history into chronological order (the database returned newest-first,
the AI needs oldest-first), label each message as either "user" or "assistant",
and add a system instruction at the top telling the AI how to behave.

### Step 12 — Ask DeepSeek

Send the conversation. Get back the reply text and a count of how many words
were used.

### Step 13 — Send the reply to WhatsApp

Make an HTTP request to Meta with the AI's answer and the recipient's number.
Meta returns a message ID confirming acceptance.

Your phone buzzes.

### Step 14 — Write the reply to the database

Save the bot's own message with direction "out". **This is the memory step.**
Without it, the next question can't be answered in context, because history
would only ever contain your side of the conversation.

### Step 15 — Close the books

Update the `assistant_runs` row: mark it completed, record which outbound
message it produced, and store the word counts for cost tracking.

Done. Total elapsed time: a few seconds.

---

## Part 5 — Node by node

The workflow has 23 nodes. They form two independent branches that happen to
share one URL.

### Branch A — The handshake (4 nodes)

Used once, at setup. Meta needs to prove your webhook URL is really yours
before it'll send you anything.

#### `Webhook` (GET)
Listens for Meta's verification request. Meta sends a GET with three query
parameters: a mode, a secret you chose earlier, and a random challenge string.

#### `If`
Checks the request is a genuine verification attempt.

**Why it matters:** this is where you prove you know the shared secret. Anyone
can guess your URL; only you know the token.

> **Known gap in this build:** this node currently only checks the mode, not
> the secret token. It should check both. Low risk for a private test number,
> but it's a real deviation from the design.

#### `Respond to Webhook` (success)
Echoes the challenge string back. Meta sees its own random string returned and
concludes you control the endpoint.

#### `Respond to Webhook1` (failure)
Returns 403 to anything that fails the check.

---

### Branch B — The message pipeline (19 nodes)

#### `Webhook1` (POST)
The real entrance. Every inbound message, delivery receipt, and read receipt
arrives here.

#### `If1` — is this a message?
Checks the payload actually contains a non-empty list of messages.

**Why it matters:** most incoming traffic is receipts, not messages. Without
this guard the workflow would try to parse a delivery confirmation as if it
were a text and either crash or write garbage to the database. In practice
this node discards the majority of what arrives.

#### `Respond OK (status)`
Answers 200 to the receipts that `If1` filtered out. They still need a reply —
Meta retries anything it doesn't get an acknowledgement for.

#### `Edit Fields` — the translator
Digs the five useful values out of Meta's deeply nested JSON:

| Field | Meaning |
|---|---|
| `from_number` | who sent it |
| `message_text` | what it says (empty for non-text) |
| `wa_message_id` | WhatsApp's unique ID for this message |
| `timestamp` | when it was sent |
| `message_type` | text, image, audio… |

**Why it matters:** everything downstream reads from this node. It's the
single point where a messy external format becomes a clean internal one. If
Meta changes their payload shape, this is the only node that needs updating.

#### `Log to Supabase` — the inbound record
Writes the message to the `messages` table.

Two details do the real work:

- The `wa_message_id` column has a **unique constraint**, so the same message
  physically cannot be stored twice.
- The insert is told to **silently ignore** duplicates rather than error.

**Why it matters:** this is idempotency layer one. If Meta delivers the same
message twice, the second insert is quietly discarded instead of crashing the
workflow. It also stores the complete original payload, so if something looks
wrong weeks later you can inspect exactly what Meta sent.

#### `Respond OK (msg)` — the fast acknowledgement
Replies 200 to Meta immediately.

**Why it matters:** covered in Step 7 above — the AI is too slow to make Meta
wait for it. Acknowledge now, think later.

A useful side effect: because this fires early, none of the branches after it
need their own reply node. The conversation with Meta is already over.

#### `Allowed Sender` — the bouncer
Is this from the one permitted phone number?

**Why it matters:** the webhook URL is public. Anyone who discovers it can
POST a fake message. This node means only one number can ever trigger an AI
call — so a stranger can't run up your API bill or use your bot.

#### `text message` — the type check
Is this actually text?

**Why it matters:** the AI reads text. Sending it an image ID produces
nonsense or an error. This routes non-text to a polite canned reply instead.

**True** → the AI pipeline.
**False** → `Send text-only reply`.

#### `Claim assistant run` — the double-reply guard
Calls a database function that tries to insert a row keyed on this message's
ID, and reports back whether it succeeded.

**Why it matters:** this is idempotency layer two, and it's stronger than the
first. Layer one stops duplicate *storage*. This stops duplicate *work* — the
expensive, user-visible kind. Without it, a message delivered twice by Meta
produces two AI calls and two replies to the user.

The database enforces it, not the workflow. Even if two copies arrive at the
exact same instant, Postgres only lets one win.

#### `Claim succeeded` — did we win the claim?
Reads the answer from the previous node.

**True** → we're the first to handle this. Continue.
**False** → someone already did. Stop.

#### `Load history` — fetch the conversation
Queries the database for the 10 most recent messages with this person, newest
first, skipping any with empty text.

**Why it matters:** this is what makes the bot feel like it's having a
conversation instead of answering isolated questions.

**Why 10 and not everything:** you pay per word sent. Every extra message
costs money on every future call, forever. Ten is enough for a natural
back-and-forth without the bill growing unbounded.

#### `Build DeepSeek request` — the formatter
A small piece of code that:

1. **Reverses the order.** The database returned newest-first (that's how you
   ask for "the most recent 10"). The AI needs oldest-first, because a
   conversation read backwards is nonsense.
2. **Labels each message.** Inbound messages become "user", outbound become
   "assistant". This is how the model knows who said what.
3. **Adds a system instruction** at the top — the standing behavioural
   directive ("keep answers short and plain").
4. **Sets limits** — which model, maximum reply length.

**Why it matters:** the AI won't accept raw database rows. This translates
your storage format into the model's expected format. It's the mirror image of
`Edit Fields`: that one converted external → internal, this one converts
internal → external.

#### `DeepSeek chat` — ask the model
Sends the assembled conversation. Gets back the reply and the word counts.

#### `Send WhatsApp reply` — deliver it
Posts the AI's answer to Meta's send endpoint, addressed to the original
sender. Meta returns an ID for the outgoing message.

#### `Log outbound` — the memory step
Saves the bot's reply to the same `messages` table, marked as outbound.

**Why it matters — this is the one people forget.** `Load history` reads that
table. If replies aren't written to it, the history is one-sided: the AI sees
only your questions, never its own answers, and can't reference anything it
previously said. Follow-up questions break.

The system worked "fine" before this node existed — the bot replied to
everything. The failure was invisible until someone asked a question that
depended on the bot's own earlier answer.

#### `Complete run` — close the books
Updates the `assistant_runs` row: status completed, which reply it produced,
how many words were used, and when it finished.

**Why it runs after `Log outbound` and not before:** the runs table stores a
reference to the outbound message, and the database enforces that the
referenced message actually exists. Write the reference before the message
exists and the database rejects it. Order isn't stylistic here — it's a
constraint.

**Why bother at all:** it converts the runs table from a lock into a ledger.
You can answer "how many messages did I handle today", "what did they cost",
"which ones failed", without re-reading every raw payload.

#### `Send text-only reply` + `Log text-only reply`
The non-text path. Sends a fixed message explaining only text is supported,
and logs it like any other outbound message.

**Why it logs:** consistency. Every message the bot sends ends up in the same
table regardless of which branch produced it, so history is complete and the
audit trail has no holes.

**Note:** this path never claims a run and never calls the AI. Nothing here
costs money.

#### `Mark run failed` — the error path
The AI call, the send, and the outbound log are all configured so that on
failure they route here instead of just dying. This node marks the run failed
and records the error code and message.

**Why it matters:** without it, a failure leaves a run stuck at "claimed"
forever, with no record of what went wrong. Worse — because the message was
already claimed, a retry would be *rejected* as a duplicate. You'd have a
message that can never be answered and no explanation why.

This turns a silent hang into a diagnosable event.

---

## Part 6 — Every path through the system

Only one of these runs per incoming request.

| What arrived | Path | AI called? | Cost |
|---|---|---|---|
| Delivery/read receipt | `If1` false → acknowledge | No | Free |
| Message from a stranger | Blocked at `Allowed Sender` | No | Free |
| Image or voice note | Fixed reply → logged | No | Free |
| Duplicate delivery | Blocked at `Claim succeeded` | No | Free |
| **Normal text message** | **Full pipeline** | **Yes** | **Paid** |
| Text, but AI or send fails | Marked failed with reason | Maybe | Maybe |

Notice how much is designed to *avoid* reaching the AI. That's not accidental —
the AI is the only step that costs money and the only one that's slow.

---

## Part 7 — The three questions, answered

### Why must `Complete run` come after `Log outbound`?

`Complete run` records *which* outbound message the run produced. The database
enforces that this reference points at a real row in the `messages` table.

`Log outbound` is what creates that row. Run the update first and the database
rejects it — you'd be pointing at something that doesn't exist yet.

This is a **foreign key**: a rule saying "this column must match a real row
over there." It exists so the data can't drift into a state where a run claims
to have produced a message that was never recorded.

### What breaks if `Load history` fetches 100 instead of 10?

Nothing *breaks* immediately. It degrades:

1. **Cost rises on every call, permanently.** You're billed per word sent. Ten
   times the history is roughly ten times the input cost, on every message,
   forever.
2. **It gets slower.** More text to transmit and process.
3. **Eventually it hard-fails.** Models have a maximum input size. Long enough
   conversations will exceed it and the call errors out.
4. **Answers can get worse.** Models can lose focus across very long contexts,
   giving weight to something from 90 messages ago that no longer matters.

Ten is a judgement call — enough for natural conversation, small enough to
stay cheap and predictable.

### Why does `Claim succeeded` read the previous node directly, when its neighbours reach back to `Edit Fields` by name?

Because of what each node is asking for.

The default way to read data in n8n means **"whatever the node immediately
before me produced."** That's only useful if the node before you produced
something you want.

- `Claim succeeded` wants the claim result. `Claim assistant run` sits directly
  before it and returns exactly that. Default access is correct.
- `Allowed Sender` wants the sender's phone number. The node before it is a
  database write, which returns an **empty response**. The phone number was
  produced five nodes earlier, at `Edit Fields`.

So nodes that need the original parsed message have to **name** the node that
produced it, rather than relying on position.

**The general rule:** the moment a chain passes through something that returns
its own data — a database write, an API call, a response node — the original
message data is gone from the default path. Reach back by name.

This caused a real bug in this build. Two nodes were originally written using
default access, ended up comparing against nothing at all, and would have
silently blocked every message forever.

---

## Part 8 — Design decisions worth understanding

### Why reply to Meta before doing the work
Meta wants a fast acknowledgement. The AI is slow. Making Meta wait causes
timeouts, which cause retries, which cause duplicate messages. Acknowledging
early decouples "did we receive it" from "have we finished thinking."

### Why idempotency is enforced twice
The unique constraint on stored messages prevents duplicate *records*. The
claim step prevents duplicate *work*. They protect different things, and the
second is the one users would notice.

### Why the database does the locking, not the workflow
If the workflow checked "does a row exist?" and then inserted one, two
simultaneous copies could both check, both see nothing, and both proceed.
Letting the database's uniqueness rule decide the winner removes that race
entirely.

### Why the raw payload is stored
Parsing throws information away. Keeping the original means you can answer
questions weeks later that you didn't think to ask at the time — and if the
parsing logic turns out to be wrong, you can reprocess.

### Why credentials live in n8n rather than in the workflow
The exported workflow file only references credentials by name. The secrets
themselves are encrypted separately. That's what makes it safe to commit the
workflow to a public repository.

---

## Part 9 — Failure modes and where they'd show

| Symptom | Likely cause |
|---|---|
| Nothing arrives at all | n8n or ngrok not running; app not subscribed to the account |
| Bot replies twice | Claim step bypassed or failing |
| Bot has no memory | Outbound logging broken — history is one-sided |
| Replies accepted but never arrive | 24-hour window closed |
| Everything stalls after the AI | Send step failing; check the runs table for the error |
| Runs stuck at "claimed" | Something failed before completion and the error path didn't catch it |
| A guard never passes | Reading data by position where it should read by name |

---

## Part 10 — The shape of it

Strip away the syntax and this is the whole design:

1. **Accept** anything, acknowledge fast
2. **Filter** aggressively — most traffic isn't work
3. **Record** before processing
4. **Claim** so work happens exactly once
5. **Gather** bounded context
6. **Translate** into the format the external system wants
7. **Call** the expensive thing
8. **Deliver** the result
9. **Record** what you produced, so the next round has memory
10. **Close** the ledger, or record why you couldn't

That sequence isn't specific to WhatsApp or to AI. It's the shape of nearly
every system that accepts events from outside, does something costly with
them, and has to stay correct when the network misbehaves.

The WhatsApp bot is the excuse. The sequence is the thing worth learning.
