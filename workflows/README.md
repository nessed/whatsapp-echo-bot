# workflows/

Exported n8n workflow JSON. These are **snapshots**, not the running system —
editing a file here changes nothing until someone imports it into n8n.

## Which file to import

| File | Nodes | Status |
|---|---|---|
| **`whatsapp-deepseek-assistant.json`** | 23 | **This is the live system. Import this one.** |
| `echo-bot.json` | 10 | Historical. The step-4/5 echo-bot stage, before the DeepSeek branch existed. Kept for reference; do not import. |

> ⚠️ **Both files have the internal name `"My workflow"`**, so n8n will show
> them with identical labels if you import both. Import only
> `whatsapp-deepseek-assistant.json`, and rename it in the n8n GUI afterwards.
> (The name isn't corrected in the JSON on purpose — the live instance is still
> called "My workflow", and changing only the export would create a permanent
> phantom diff on the next export.)

## What these files do and don't contain

**Do contain:** every node, its parameters, the wiring between nodes, and
credential **ids and names**.

**Do not contain:** any credential secret. n8n keeps credential values
encrypted on its own side and never puts them in an export. That's deliberate —
don't "fix" it by inlining a token.

So after importing you must re-select credentials on each node that needs one.
The assistant workflow references three:

- `Supabase (messages)` — type `supabaseApi`
- `DeepSeek account` — type `deepSeekApi`
- `Meta WhatsApp` — type `httpHeaderAuth`

Setup instructions: [../docs/SETUP.md](../docs/SETUP.md).

## After importing, change these

The workflow does **not** read `.env`. Three values are hardcoded in nodes and
belong to whoever exported it:

| Node | Literal | Change to |
|---|---|---|
| `Allowed Sender` | `<ALLOWED_NUMBER>` | your handset, digits only, no `+` |
| `Send WhatsApp reply` | `1303482916173126` in the URL | your Meta phone number id |
| `Send text-only reply` | `1303482916173126` in the URL | your Meta phone number id |

The seven Supabase nodes and the DeepSeek node point at shared services — leave
those alone.

## Re-exporting

n8n GUI → workflow menu → Download → save over
`whatsapp-deepseek-assistant.json`.

Because of the three literals above, exports legitimately differ between
developers. See
[../CONTRIBUTING.md](../CONTRIBUTING.md#your-workflow-export-will-differ-from-theirs)
for how to handle that.
