from fastapi import APIRouter
from pinecone import Pinecone
from typing import List, Dict, Union
import os

router = APIRouter()

class SparseService:
    def __init__(self):
        api_key = os.getenv("PINECONE_API_KEY")
        if not api_key:
            raise ValueError("PINECONE_API_KEY environment variable not set")
        self.pc = Pinecone(api_key=api_key)

    async def get_sparse_embeddings(
        self, texts: List[str], input_type: str, return_tokens: bool = False
    ) -> List[Dict[str, Union[Dict[int, float], List[str]]]]:
        """
        Get sparse embeddings using Pinecone's sparse English model.
        
        Args:
            texts: List of texts to embed
            input_type: Either 'query' or 'passage'
            return_tokens: Whether to return the tokens along with the embeddings
            
        Returns:
            List of dictionaries containing sparse embeddings and optionally tokens
        """
        if input_type not in ["query", "passage"]:
            raise ValueError("input_type must be either 'query' or 'passage'")  

        try:
            
            response = self.pc.inference.embed(
                model="pinecone-sparse-english-v0",
                inputs=texts,
                parameters={
                    "input_type": input_type,
                    "return_tokens": return_tokens,
                }
            )
            
            if response is None:
                raise ValueError("Received None response from Pinecone")
                
            # Convert Pinecone response to a serializable format
            if isinstance(response.data, list):
                return [
                    {
                        "values": item.sparse_values,
                        "indices": item.sparse_indices
                    }
                    for item in response.data
                ]
            else:
                # If it's a single embedding
                return [{
                    "values": response.data.sparse_values,
                    "indices": response.data.sparse_indices
                }]
                
        except Exception as e:
            print(f"DEBUG - Error in get_sparse_embeddings: {str(e)}")
            raise