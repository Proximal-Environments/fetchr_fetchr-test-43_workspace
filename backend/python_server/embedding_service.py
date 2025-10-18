# import asyncio
# import torch
# from transformers import AutoModel, AutoProcessor
# from typing import List, Optional, Dict
# import numpy as np
# from PIL import Image
# import hashlib
# import io

# class EmbeddingService:
#     def __init__(self):
#         self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
#         self.model = AutoModel.from_pretrained('Marqo/marqo-fashionSigLIP', trust_remote_code=True).to(self.device)
#         self.processor = AutoProcessor.from_pretrained('Marqo/marqo-fashionSigLIP', trust_remote_code=True)
#         self.embeddings_cache: Dict[str, List[float]] = {}

#     def _generate_cache_key(self, text: str) -> str:
#         return hashlib.sha256(text.encode()).hexdigest()

#     def _generate_image_key(self, image: Image.Image) -> str:
#         with io.BytesIO() as buffer:
#             image.save(buffer, format='PNG')
#             image_bytes = buffer.getvalue()
#         return hashlib.sha256(image_bytes).hexdigest()

#     async def get_query_embedding_async(self, query: str) -> List[float]:
#         return await asyncio.to_thread(self.get_query_embedding, query)

#     def get_query_embedding(self, query: str) -> List[float]:
#         cache_key = self._generate_cache_key(query)
#         if cache_key in self.embeddings_cache:
#             return self.embeddings_cache[cache_key]

#         embedding = self._generate_embedding(query)
#         self._cache_embedding(cache_key, embedding)
#         return embedding

#     def _generate_embedding(self, query: str) -> List[float]:
#         inputs = self.processor(text=[query], padding='max_length', return_tensors="pt")
#         inputs = {k: v.to(self.device) for k, v in inputs.items()}

#         with torch.no_grad():
#             text_features = self.model.get_text_features(**inputs)
#             text_features = text_features / text_features.norm(dim=-1, keepdim=True)

#         return text_features.cpu().numpy()[0].tolist()

#     def _cache_embedding(self, cache_key: str, embedding: List[float]) -> None:
#         self.embeddings_cache[cache_key] = embedding

#     async def batch_get_query_embedding_async(
#         self, queries: List[str]
#     ) -> List[List[float]]:
#         return await asyncio.to_thread(self.batch_get_query_embedding, queries)

#     def batch_get_query_embedding(
#         self, queries: List[str]
#     ) -> List[List[float]]:
#         results = []
#         queries_to_embed = []
#         query_indices = []

#         for i, query in enumerate(queries):
#             cache_key = self._generate_cache_key(query)
#             if cache_key in self.embeddings_cache:
#                 results.append(self.embeddings_cache[cache_key])
#             else:
#                 queries_to_embed.append(query)
#                 query_indices.append(i)

#         if queries_to_embed:
#             embeddings = self._generate_batch_embedding(queries_to_embed)

#             for query, embedding in zip(queries_to_embed, embeddings):
#                 cache_key = self._generate_cache_key(query)
#                 self._cache_embedding(cache_key, embedding)

#             for idx, embedding in zip(query_indices, embeddings):
#                 results.insert(idx, embedding)

#         return results

#     def _generate_batch_embedding(self, queries: List[str]) -> List[List[float]]:
#         inputs = self.processor(text=queries, padding='max_length', return_tensors="pt")
#         inputs = {k: v.to(self.device) for k, v in inputs.items()}

#         with torch.no_grad():
#             text_features = self.model.get_text_features(**inputs)
#             text_features = text_features / text_features.norm(dim=-1, keepdim=True)

#         return text_features.cpu().numpy().tolist()

#     def get_image_embedding(self, image: Image.Image) -> List[float]:
#         image_key = self._generate_image_key(image)
#         if image_key in self.embeddings_cache:
#             return self.embeddings_cache[image_key]

#         inputs = self.processor(images=[image], padding='max_length', return_tensors="pt")
#         inputs = {k: v.to(self.device) for k, v in inputs.items()}

#         with torch.no_grad():
#             image_features = self.model.get_image_features(**inputs)
#             image_features = image_features / image_features.norm(dim=-1, keepdim=True)

#         embedding = image_features.cpu().numpy()[0].tolist()
#         self._cache_embedding(image_key, embedding)
#         return embedding

#     def update_embedding(
#         self,
#         current_embedding: List[float],
#         liked_items: Optional[List[List[float]]] = None,
#         disliked_items: Optional[List[List[float]]] = None
#     ) -> List[float]:
#         updated_embedding = np.array(current_embedding)

#         if liked_items:
#             liked_embeddings = [emb for emb in liked_items if emb is not None]
#             if liked_embeddings:
#                 liked_avg = np.mean(liked_embeddings, axis=0)
#                 updated_embedding += liked_avg * 0.1

#         if disliked_items:
#             disliked_embeddings = [emb for emb in disliked_items if emb is not None]
#             if disliked_embeddings:
#                 disliked_avg = np.mean(disliked_embeddings, axis=0)
#                 updated_embedding -= disliked_avg * 0.05

#         return (updated_embedding / np.linalg.norm(updated_embedding)).tolist() 