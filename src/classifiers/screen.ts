import type { Images } from '@/db/schema'
import type { LLMService } from '@/services/llm'

interface ImageScreeningResult {
  isAcceptable: boolean
  rejectionReason?: 'nudity' | 'blurry' | 'blank' | 'dark' | 'resolution' | 'orientation' | 'receipts' | 'qr' | 'none' | 'presentation' | 'screenshot' | null
  qualityIssue?: string
}

const screeningPrompt = `
            Analyze this image for both content and quality.

            Check for:
            1. Nudity (reject if present)
            2. Focus/blur issues
            3. Blank or near-blank images
            4. Darkness/exposure problems
            5. Resolution (reject if low)
            6. Orientation problems
            7. Receipts
            8. Presentation slides
            9. Screenshot (including Instagram screenshots)
            10. QR Code
          
            Respond with JSON:
            {
                "isAcceptable": <boolean>,
                "rejectionReason": "nudity" | "blurry" | "blank" | "dark" | "resolution" | "orientation" | "receipts" | "qr" | "presentation" | "screenshot" |  null,
                "qualityIssue": "<if quality issue, brief description>"
            }
            
            Only reject for:
            - Actual nudity (not swimwear/athletic wear)
            - Clear technical problems (not artistic choices)
        `

export class ImageScreener {
  constructor(private llm: LLMService) {}

  async screenImage(photo: Images, buffer: Buffer, fileType: string): Promise<ImageScreeningResult | null> {
    try {
      console.log(`Screening image ${photo.dropboxFileName}`)
      const result = await this.llm.analyzeImageBuffer<ImageScreeningResult>(buffer, fileType, screeningPrompt)
      const rejectionReason = result.rejectionReason || 'none'

      console.log(`Screening result for ${photo.dropboxFileName}`, { result })
      return {
        ...result,
        rejectionReason
      }
    } catch (e) {
      console.error('Error screening image', { e })
      return null
    }
  }
}
