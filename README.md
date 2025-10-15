# ai-agent-example (GitHub agent vertical slice)

This workspace contains a minimal TypeScript Node backend focused on a single vertical slice: a GitHub PR agent. The goal is to scaffold a small server and a GitHub agent endpoint you can call from Postman.

Quick start

1. Copy `.env.example` to `.env` and populate `GITHUB_TOKEN` if you want live behavior.
2. Install dependencies:

```bash
npm install
```

3. Start in dev mode:

```bash
npm run dev
```

4. POST to `http://localhost:3000/api/agents/github` with a JSON body (see `postman/` collection) to test simulated or live PR creation.

Notes

- If `GITHUB_TOKEN` is not set, the agent returns a simulated response (no network calls).
- The code is intentionally minimal — later we'll generalize the ai wrapper and add Slack/Jira agents.
