import { pineconeService } from '../src/fetchr/base/service_injection/global';

const query = `Meshki cute white dress with contrast`;
// const query2 = `SoCal style is a constant reference for Gallery Dept. - this 'Collector' baseball cap takes inspiration from fitted designs you see in LA`;

const products = await pineconeService.searchProducts(query, undefined, undefined, {
  embedding_version: 5,
});

console.log('Products:', products);
