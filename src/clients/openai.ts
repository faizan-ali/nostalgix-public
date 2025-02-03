import { wait } from '@/lib/async'
import OpenAI, { type APIError } from 'openai'
import type { ChatCompletion, ChatCompletionCreateParams, ChatCompletionMessage } from 'openai/resources/chat/completions'
import type { CreateEmbeddingResponse, EmbeddingCreateParams } from 'openai/resources/embeddings'
import PQueue from 'p-queue'

// Enhanced error types
export class OpenAIRateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message)
    this.name = 'OpenAIRateLimitError'
  }
}

export class OpenAIAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string | null,
    public param?: string | null
  ) {
    super(message)
    this.name = 'OpenAIAPIError'
  }
}

export class OpenAITimeoutError extends Error {
  constructor(
    message: string,
    public timeoutMs: number
  ) {
    super(message)
    this.name = 'OpenAITimeoutError'
  }
}

export interface RetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  timeout?: number
}

export class OpenAIClient {
  private readonly client: OpenAI
  private readonly retryConfig: RetryConfig
  private readonly queue: PQueue

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
    this.retryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffFactor: 2,
      timeout: 60000
    }

    // Initialize queue with defaults optimized for OpenAI's rate limits
    this.queue = new PQueue({
      concurrency: 8,
      intervalCap: 500,
      interval: 60000,
      carryoverConcurrencyCount: true
    })

    // Add queue error handling
    this.queue.on('error', error => {
      console.error('Queue error:', error)
    })
  }

  private async handleTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      wait(timeoutMs).then(() => {
        reject(new OpenAITimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs))
      })
    })

    return Promise.race([promise, timeout])
  }

  private mapAPIError(error: APIError): OpenAIAPIError | OpenAIRateLimitError {
    if (error.status === 429) {
      const retryAfter = Number.parseInt(error.headers?.['retry-after'] || '5', 10)
      return new OpenAIRateLimitError('Rate limit exceeded', retryAfter)
    }

    // Map specific error codes
    switch (error.status) {
      case 400:
        return new OpenAIAPIError('Invalid request parameters', error.status, error.code, error.param)
      case 401:
        return new OpenAIAPIError('Invalid API key or authentication', error.status, error.code)
      case 403:
        return new OpenAIAPIError('Permission denied or account issue', error.status, error.code)
      case 404:
        return new OpenAIAPIError('Requested resource not found', error.status, error.code)
      case 500:
      case 502:
      case 503:
      case 504:
        return new OpenAIAPIError('OpenAI service error', error.status, error.code)
      default:
        return new OpenAIAPIError(error.message || 'Unknown API error', error.status, error.code)
    }
  }

  private async handleRetry<T>(operation: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      const timeoutPromise = this.handleTimeout(operation(), this.retryConfig.timeout!)
      return await timeoutPromise
    } catch (error) {
      if (error instanceof OpenAITimeoutError) {
        if (attempt < this.retryConfig.maxRetries) {
          return this.handleRetry(operation, attempt + 1)
        }
        throw error
      }

      if (error instanceof OpenAI.APIError) {
        const mappedError = this.mapAPIError(error)

        if (mappedError instanceof OpenAIRateLimitError && attempt < this.retryConfig.maxRetries) {
          const delay = Math.min(this.retryConfig.initialDelayMs * this.retryConfig.backoffFactor ** attempt, this.retryConfig.maxDelayMs)

          await wait(Math.max(delay, (mappedError.retryAfter || 1) * 1000))
          return this.handleRetry(operation, attempt + 1)
        }

        throw mappedError
      }

      throw error
    }
  }

  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    const operation = async (): Promise<string> => {
      const response = await this.handleRetry(async () => {
        return this.client.chat.completions.create({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl
                  }
                }
              ]
            }
          ]
        })
      })

      if (!response.choices[0]?.message?.content) {
        throw new OpenAIAPIError('No response content received from vision API', 500)
      }

      return response.choices[0].message.content
    }

    const result = await this.queue.add<string>(operation)

    if (result === undefined) {
      throw new Error('Queue operation failed')
    }

    return result
  }

  async analyzeImageBuffer(buffer: Buffer, fileType: string, prompt: string): Promise<string> {
    const operation = async (): Promise<string> => {
      const base64Image = buffer.toString('base64')

      const response = await this.handleRetry(async () => {
        return this.client.chat.completions.create({
          model: 'gpt-4o',
          response_format: { type: 'json_object' },
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/${fileType === 'jpg' ? 'jpeg' : fileType};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        })
      })

      if (!response.choices[0]?.message?.content) {
        throw new OpenAIAPIError('No response content received from vision API', 500)
      }

      return response.choices[0].message.content
    }

    const result = await this.queue.add<string>(operation)

    if (result === undefined) {
      throw new Error('Queue operation failed')
    }

    return result
  }

  /**
   * Creates embeddings for the given text
   */
  async createEmbedding(input: string | string[], params: Partial<Omit<EmbeddingCreateParams, 'input' | 'model'>> = {}): Promise<CreateEmbeddingResponse> {
    const operation = async (): Promise<CreateEmbeddingResponse> => {
      return await this.handleRetry(async () => {
        return this.client.embeddings.create({
          model: 'text-embedding-ada-002',
          input,
          ...params
        })
      })
    }

    const result = await this.queue.add<CreateEmbeddingResponse>(operation)
    if (result === undefined) {
      throw new Error('Queue operation failed')
    }
    return result
  }

  /**
   * Makes a chat completion API call
   */
  async createChatCompletion(messages: ChatCompletionMessage[], params: Partial<Omit<ChatCompletionCreateParams, 'messages' | 'model'>> = {}): Promise<ChatCompletion> {
    const operation = async (): Promise<ChatCompletion> => {
      return await this.handleRetry(async () => {
        return this.client.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages,
          ...params
        }) as Promise<ChatCompletion>
      })
    }

    const result = await this.queue.add<ChatCompletion>(operation)

    if (result === undefined) {
      throw new Error('Queue operation failed')
    }

    return result
  }
}
