import { OpenAIClient } from '@/clients/openai'
import { env } from '@/lib/env'

interface VisionLLMResponse {
  scores: Record<string, number>
  reasoning: string
}

export class LLMService {
  private openai = new OpenAIClient(env.OPENAI_API_KEY)

  async analyzeImage<T = VisionLLMResponse>(photoUrl: string, prompt: string): Promise<VisionLLMResponse & T> {
    if (!photoUrl) {
      throw new Error('No photo URL provided')
    }

    try {
      const response = await this.openai.analyzeImage(photoUrl, prompt)

      try {
        return JSON.parse(response) as VisionLLMResponse & T
      } catch (e) {
        console.error('Error parsing response:', { e })
        throw e
      }
    } catch (e2) {
      console.error('Error analyzing image:', { e: e2 })
      throw e2
    }
  }

  async analyzeImageBuffer<T = VisionLLMResponse>(buffer: Buffer, fileType: string, prompt: string): Promise<VisionLLMResponse & T> {
    if (!buffer) {
      throw new Error('No photo provided')
    }

    try {
      const response = await this.openai.analyzeImageBuffer(buffer, fileType, prompt)

      try {
        return JSON.parse(response) as VisionLLMResponse & T
      } catch (e) {
        console.error('Error parsing response:', { e })
        throw e
      }
    } catch (e2) {
      console.error('Error analyzing image:', { e: e2 })
      throw e2
    }
  }
}
