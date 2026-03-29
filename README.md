# Memonaut
![Memonaut](assets\logo.png)
> Your private AI second brain — capture anything, understand everything, on your device.

---

## What is Memonaut?

Memonaut is a lightweight desktop application that runs silently in the background. Hit a hotkey on anything you read — an article, a research paper, a code snippet — and it's captured instantly. Later, have a natural conversation with everything you've saved.

---

## Why Memonaut?

Tools like Notion and Obsidian require discipline to use consistently. Rewind AI records everything and sends it to the cloud. Memonaut sits in the middle — you choose what to capture, and everything stays local by default.

---

## How it Works
```
Capture  → hotkey or floating button on any text
Store    → saved locally on your machine
Chat     → ask questions about what you've captured
```

---

## AI Options

Not every laptop can run a local LLM comfortably. Memonaut gives you a choice:

| Option | How | Privacy |
|---|---|---|
| Local model (0.5B) | Runs fully on your device | Complete |
| Hugging Face API | Free inference API, bring your own key | Partial |
| Gemini API | Google's free tier, bring your own key | Partial |

You pick what works for your machine. No option is forced on you.

---

## Tech Stack

- **Desktop** — Electron + React + TypeScript
- **UI** — Framer Motion + Tailwind CSS
- **Backend** — Python + FastAPI
- **RAG** — FAISS + sentence-transformers
- **Storage** — SQLite

---

## Status

🚧 Early development. Not ready for use yet.

Building in public — star the repo to follow along.

---

## License

MIT © 2025 Madhan