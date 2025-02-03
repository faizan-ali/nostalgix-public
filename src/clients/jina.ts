import { env } from '@/lib/env'
import fetch from 'node-fetch'

type EmbeddingResponse =
  | {
      model: string
      object: string
      usage: {
        total_tokens: number
        prompt_tokens: number
      }
      data: Array<{
        object: string
        index: number
        embedding: Array<number>
      }>
    }
  | { detail: string }

export const createEmbedding = async (base64: string): Promise<number[]> => {
  if (!env.EMBEDDINGS_API_KEY) {
    throw new Error('Embeddings API key is required')
  }

  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.EMBEDDINGS_API_KEY}`
    },
    body: JSON.stringify({
      model: 'jina-clip-v2',
      dimensions: 1024,
      normalized: true,
      embedding_type: 'float',
      input: [{ image: base64 }]
    })
  }

  return fetch('https://api.jina.ai/v1/embeddings', requestOptions)
    .then(response => response.json())
    .then(data => {
      console.log('Embeddings response', { data })
      if ('detail' in (data as EmbeddingResponse)) {
        console.error('Error creating image embedding', { data })
        throw new Error('Error creating image embedding')
      } else if ('data' in (data as EmbeddingResponse)) {
        // @ts-expect-error Fuck this
        return (data as EmbeddingResponse).data[0].embedding
      } else {
        throw new Error('Unexpected Jina response')
      }
    })
    .catch(e => {
      console.error('Error creating image embedding', { e })
      throw e
    })
}
