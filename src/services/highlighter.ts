import { ContentAnalyzer } from '@/analyzers/content'
import { EmotionalAnalyzer } from '@/analyzers/emotional'
import { TechnicalAnalyzer } from '@/analyzers/technical'
import type { Database } from '@/db'
import { Images } from '@/db/schema'
import type { LLMService } from '@/services/llm'
import { eq } from 'drizzle-orm'

export class Highlighter {
  private readonly technicalAnalyzer: TechnicalAnalyzer
  private readonly contentAnalyzer: ContentAnalyzer
  private readonly emotionalAnalyzer: EmotionalAnalyzer

  constructor(
    llm: LLMService,
    private db: Database
  ) {
    this.technicalAnalyzer = new TechnicalAnalyzer(llm)
    this.contentAnalyzer = new ContentAnalyzer(llm)
    this.emotionalAnalyzer = new EmotionalAnalyzer(llm)
  }

  async highlightImageAndPersist(photo: Images, buffer: Buffer, fileType: string) {
    try {
      const [technical, content, emotional] = await Promise.all([
        photo.technicalScore
          ? Promise.resolve(photo.technicalScore)
          : this.technicalAnalyzer.assessQuality(buffer, fileType).then(async ({ score, reasoning }) => {
              await this.db
                .update(Images)
                .set({
                  technicalScore: score,
                  technicalReason: reasoning
                })
                .where(eq(Images.id, photo.id))
              return score
            }),
        photo.contentScore
          ? Promise.resolve({ score: photo.contentScore, isSelfie: photo.isSelfie })
          : this.contentAnalyzer.analyzeContent(buffer, fileType).then(async ({ score, reasoning, isSelfie }) => {
              await this.db
                .update(Images)
                .set({
                  contentScore: score,
                  contentReason: reasoning,
                  isSelfie: Boolean(isSelfie)
                })
                .where(eq(Images.id, photo.id))
              return { score, isSelfie }
            }),
        photo.emotionalScore
          ? Promise.resolve(photo.emotionalScore)
          : this.emotionalAnalyzer.analyzeEmotionalImpact(buffer, fileType).then(async ({ score, reasoning }) => {
              await this.db
                .update(Images)
                .set({
                  emotionalScore: score,
                  emotionalReason: reasoning
                })
                .where(eq(Images.id, photo.id))
              return score
            })
      ])

      const isSelfie = content.isSelfie
      const technicalMultiplier = isSelfie ? 0.15 : 0.35
      const emotionalMultiplier = isSelfie ? 0.55 : 0.35
      const totalScore = technical * technicalMultiplier + content.score * 0.3 + emotional * emotionalMultiplier

      console.log(`Highlighter for ${photo.dropboxFileName}`, {
        totalScore,
        technical,
        content,
        emotional
      })

      return { totalScore, isSelfie }
    } catch (e) {
      console.log('Error in highlightImage', { e })
      throw e
    }
  }
}
