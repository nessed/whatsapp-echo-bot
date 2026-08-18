# NotebookLM instructions

## What to upload

Upload **`WORKFLOW-EXPLAINED.md`** (in this same `docs/` folder). That one file is self-contained.

Optionally also upload `workflows/whatsapp-deepseek-assistant.json` — the
actual workflow file — if you want NotebookLM to be able to point at concrete
node configuration. It is not required and it is dense; skip it if the output
starts drowning in syntax.

**Do not upload** `CLAUDE.md`, `LESSONS-LEARNED.md`, or the `context/` folder
for this purpose. They're project management and debugging notes. They'll pull
the explanation toward trivia and away from the logic.

---

## Prompt for the Video Overview / Audio Overview

Paste this into the customisation box:

```
Audience: someone who understands technology in general but has never built
an automated workflow, never used n8n, and has never worked with a messaging
API. Assume intelligence, assume zero specific background.

Goal: by the end, I should be able to explain to someone else how a message
travels from a phone to an AI and back, and why each step in that journey
exists.

Structure it as a journey. Follow one single text message from the moment
someone's thumb hits send, all the way through to the reply appearing on their
screen. Then go back and examine the interesting decisions along the way.

For every step, answer three questions in this order:
1. What does this step do?
2. Why does it exist — what specific real-world problem forced someone to add
   it?
3. What would break, and how would it look to a user, if you deleted it?

Question 3 is the most important one. I want to understand each piece by
understanding its absence. Deleting a step should feel obviously bad by the
time you've explained it.

Spend the most time on these five ideas, because they're the ones that
generalise beyond this project:

- Why the system replies "got it" to WhatsApp before the AI has even been
  asked anything
- Why the same message arriving twice is a serious problem, and the two
  separate mechanisms that stop it causing a double reply
- Why an AI has no memory, and why that means the entire recent conversation
  gets re-sent on every single request
- Why saving the bot's OWN replies to the database is what creates the
  illusion of memory — and why forgetting to do that produces a bug that looks
  like everything is working
- Why most of the design is dedicated to NOT calling the AI

Explicitly skip: syntax, exact field names, punctuation, formatting rules,
whitespace issues, and anything about how expressions are typed. I do not care
how it's written. I care about what it does and why it's arranged that way.

Use analogies drawn from ordinary life — a restaurant kitchen, a receptionist
taking messages, a post office, an assembly line. Prefer a concrete comparison
over a technical restatement.

When you introduce a term like "webhook", "idempotency", "foreign key", or
"context window", define it in plain language the first time and then use it
naturally afterwards. Don't avoid the vocabulary — I want to end up owning it.

Tone: an experienced colleague walking me through a system they built, over
coffee. Direct and interested. Not a lecture, not a tutorial, no
congratulating me for asking good questions.
```

---

## Follow-up questions to ask in the chat afterwards

Once the overview exists, these force the understanding to be real rather
than passive. Ask them one at a time.

**Ordering and dependencies**
- Why can't the "close the books" step run before the reply is saved?
- What's the difference between the two duplicate-prevention mechanisms, and
  why isn't one enough?
- Which steps could be safely reordered, and which absolutely cannot?

**Consequences of change**
- If the history limit went from 10 messages to 100, what changes? What about
  down to 1?
- If the fast acknowledgement to WhatsApp were removed, describe the failure
  as the user would experience it.
- If the sender check were deleted, what could someone who found the URL do?

**Diagnosis**
- The bot replies to everything but can't answer follow-up questions. Which
  step is broken?
- Messages are being sent successfully but never arrive on the phone, with no
  error anywhere. What's the most likely explanation?
- A message is stuck and can never be answered, even on retry. How did it get
  into that state?

**Generalising**
- Which parts of this design would survive if you swapped WhatsApp for email?
- Which parts are specific to WhatsApp's rules, and which are just good
  practice for anything that receives events from the outside world?
- If you were building a bot that messages customers *first* rather than
  responding, what would have to change and why?

---

## How to know it worked

You understand this well enough when you can answer, without looking:

1. Why does the system tell WhatsApp "got it" before doing any of the work?
2. What are the two separate defences against replying twice, and why does
   having only one leave a hole?
3. Where does the bot's memory physically live, and which single step keeps it
   populated?
4. Why does most of the flowchart exist to avoid reaching the AI?

If you can explain those four out loud to someone who's never seen this, you
own the design — and that transfers to the next project.
