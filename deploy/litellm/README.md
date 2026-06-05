# LiteLLM gateway

A unified, OpenAI-compatible API (`:4000`) that gives gym-coach **embeddings** — which the
CLIProxyAPI does not serve. Why this exists:

- **Embeddings have no subscription source.** Anthropic ships no embeddings model;
  OpenAI/Gemini embeddings are API-billed, not part of the chat subscriptions. So no proxy
  can route embeddings to your Claude/Codex/Gemini-CLI plans.
- **LiteLLM bridges to local Ollama** (`mxbai-embed-large`, 1024-dim) — free, private,
  unlimited — and exposes it at `/v1/embeddings`. It also passes **chat** through to
  CLIProxyAPI, so one endpoint serves both.

## Routes (see `config.yaml`)

| model name | → backend | use |
|---|---|---|
| `embed-default` | Ollama `mxbai-embed-large` (`:11434`) | RAG embeddings, 1024-dim |
| `gpt-5.5` | CLIProxyAPI (`:8317`) | chat |
| `gemini-3-pro-preview` | CLIProxyAPI (`:8317`) | chat |

## Run

```bash
# manual
set -a; . ~/.local/share/litellm/litellm.env; set +a
~/.local/share/litellm/venv/bin/litellm --config deploy/litellm/config.yaml --port 4000

# or as a service (see ../README.md)
systemctl --user enable --now coach-litellm.service
```

Secrets (`LITELLM_MASTER_KEY`, `CLI_PROXY_API_KEY`) live in `~/.local/share/litellm/litellm.env`
(chmod 600, not in the repo). gym-coach reads the master key as `COACH_EMBED_API_KEY` in `.env`.

## Health / smoke

```bash
MK=$(grep LITELLM_MASTER_KEY ~/.local/share/litellm/litellm.env | cut -d= -f2-)
curl -s localhost:4000/v1/models -H "Authorization: Bearer $MK"
curl -s localhost:4000/v1/embeddings -H "Authorization: Bearer $MK" \
  -H 'Content-Type: application/json' -d '{"model":"embed-default","input":"hello"}'
```

## Changing the embedding model
The vector width is part of the DB schema. If you switch models, update `EMBED_DIM` and
`coach/migrations/004_pgvector.sql` to match (mxbai=1024, nomic=768, gemini-embedding-001=1536),
then re-create `rag_chunks` and re-ingest.
