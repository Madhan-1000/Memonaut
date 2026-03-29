from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app=FastAPI()

class CaptureRequest(BaseModel):
    text: str
    source: str = "unknown"

class ChatRequest(BaseModel):
    query: str
    use_case: str = "personal knowledge base"

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/capture")
def capture(req: CaptureRequest):
    print(f"Captured: {req.text[:50]}...")
    return {"status": "saved", "text": req.text}

@app.post("/chat")
def chat(req: ChatRequest):
    return {"answer": "RAG coming soon!"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)

# 1. Write daemon/main.py     → basic FastAPI with 3 endpoints
#                             → /health, /capture, /chat

# 2. Test it standalone       → python daemon/main.py
#                             → hit localhost:8765/health in browser

# 3. Connect Electron to it   → spawn Python from electron/main.ts

# 4. Verify connection        → simple status check in App.tsx

# 5. Then build the UI        → the sick stuff