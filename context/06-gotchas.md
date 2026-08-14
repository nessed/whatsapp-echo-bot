# 06 — Gotchas (symptoms)

Nineteen ways this project breaks. Symptoms only — no causes, no fixes.

These are the things that actually went wrong for people building this stack. If you hit one, you'll recognise it here, which tells you it's a known problem with a findable cause rather than something uniquely broken about your setup. That's the only help this file gives you.

Work it out yourself first. The causes and fixes are in `answers/06-gotchas-full.md`, same numbering, and it's worth going there only after you've had a real attempt.

**Three of these have nearly identical symptoms and completely different causes.** Matching a symptom to an entry here doesn't mean you've diagnosed it.

---

## Setup and credentials (build steps 1-3)

**1.** Everything worked yesterday. Today every send returns 401 with an OAuth error. You changed nothing.

**2.** Sends to your own number work fine. Sending to a friend's number to demo it fails.

**11.** 400 errors on send, or a "not found" style error on the endpoint path itself.

**12.** 400 with an unhelpful message on every send, from the very first attempt.

**14.** Behaviour that doesn't match the docs, or a deprecation error appearing out of nowhere.

**15.** All your workflows and credentials are gone after a redeploy.

**17.** Supabase inserts return 401, or appear to succeed but write nothing, or return an empty array.

---

## Webhook and verification (build steps 4-5)

**3.** Webhook verification fails with an unhelpful error and no detail about why.

**4.** Verification passes but no messages ever arrive. Or messages work, then re-verification fails later.

**8.** Verification passed, then nothing works. Or it works exactly once and never again.

**9.** The webhook URL returns 404. Looks identical to a wrong path.

**10.** Handshake verified, dashboard shows green, no messages ever arrive.

**13.** `POST /api/v1/workflows` returns 400 about unrecognised properties when you push a workflow you exported from the UI.

---

## Runtime and data (build steps 5-9)

**5.** `undefined` where the message text should be, or rows landing with null `message_text`.

**6.** The echo works, then n8n shows a burst of failed executions immediately after. Or garbage rows appear with null fields. Or the flow tries to echo something that was never a message.

**7.** Two identical rows for one message.

**16.** Error 131047 on send.

**18.** An error message that says nothing useful.

**19.** Timestamps in Supabase are off by hours from what your phone showed.

---

## How to debug, generally

The method, not the answers. Work outside in and confirm each layer before suspecting the next — with three systems in the chain, "somewhere in there" is a bad place to start.

1. **Do your credentials still work?** Run the step 1 isolation script. It touches nothing else, so a pass or fail here is unambiguous.
2. **Did the webhook fire at all?** Check n8n's execution list. No execution at all means the problem is upstream of your workflow, and nothing inside it can be at fault.
3. **What did the payload actually contain?** Open the execution and read the Webhook node's raw output. Compare it against the documented shapes in `02-meta-whatsapp-api.md` §5 — that file is reference, not answer key, so use it freely.
4. **Which node failed?** The execution view shows per-node input and output. Find the first node whose output isn't what the next one expects. That node is the problem, not the one that threw the error.
5. **What did Supabase actually receive?** Read `raw_payload` on rows that were written. If nothing was written, check Supabase's own logs rather than trusting n8n's reported success.

Write down your theory before you test it. If you skip that, you'll try six things, one will work, and you won't know which — that's the difference between fixing it and learning it.
