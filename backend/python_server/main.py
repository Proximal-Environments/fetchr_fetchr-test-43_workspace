import dotenv
dotenv.load_dotenv()

from pydantic import BaseModel
from typing import Dict, List, Union
import uvicorn
import signal
import sys
import psutil
import threading
import time

from sparse_service import SparseService
from fastapi import FastAPI

app = FastAPI()

class SparseEmbeddingRequest(BaseModel):
    texts: List[str]
    input_type: str  # 'query' or 'passage'
    return_tokens: bool = False

class SparseEmbeddingResponse(BaseModel):
    embeddings: List[Dict[str, Union[Dict[str, float], List[str]]]]


sparse_service = SparseService()
@app.post("/sparse/embed", response_model=None)
async def create_sparse_embeddings(request: SparseEmbeddingRequest):
    """
    Create sparse embeddings for the given texts.
    """
    embeddings = await sparse_service.get_sparse_embeddings(
        texts=request.texts,
        input_type=request.input_type,
        return_tokens=request.return_tokens
    )
    return {"embeddings": embeddings}

def signal_handler(signum, frame):
    print(f"\nReceived signal {signum}. Shutting down gracefully...")
    # Add any cleanup code here if needed
    sys.exit(0)

def monitor_resources():
    """Monitor and print system resource usage periodically."""
    process = psutil.Process()
    while True:
        cpu_percent = process.cpu_percent(interval=1)
        memory_info = process.memory_info()
        memory_mb = memory_info.rss / 1024 / 1024  # Convert to MB
        print(f"\nResource Usage:")
        print(f"CPU: {cpu_percent}%")
        print(f"Memory: {memory_mb:.2f} MB")
        time.sleep(5)  # Update every 5 seconds

if __name__ == "__main__":
    # Set up signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start resource monitoring in a separate thread
    # monitor_thread = threading.Thread(target=monitor_resources, daemon=True)
    # monitor_thread.start()
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=9091,
        workers=10
    )