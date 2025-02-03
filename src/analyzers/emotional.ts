import type { ScoreComponent } from '@/analyzers/types'
import type { LLMService } from '@/services/llm'

export class EmotionalAnalyzer {
  constructor(private llm: LLMService) {}

  async analyzeEmotionalImpact(buffer: Buffer, fileType: string): Promise<ScoreComponent> {
    const prompt = `
      Analyze this image's emotional impact and provide scores (0-10) for:
      
      1. Emotional Atmosphere
          For people photos:
              - Give 9-10: Powerful emotions, expressions, or interactions
              - Give 7-8: Clear positive/engaging emotions
              - Give 5-6: Basic emotional content
              - Give 0-4: Limited emotional impact
              Note: Add +1 point if capturing genuinely funny/humorous moments while maintaining visual clarity
      
          For landscapes/objects:
              - Give 9-10: Powerful mood or atmosphere AND clear visual focus
              - Give 7-8: Clear emotional atmosphere with strong subject presence
              - Give 5-6: Pleasant but standard atmosphere
              - Give 0-4: Limited atmospheric impact or unclear subject focus
      
      2. Connection/Resonance
          For people photos:
              - Give 9-10: Deep human connection or interaction AND technical excellence
              - Give 7-8: Clear engagement between subjects with good clarity
              - Give 5-6: Basic interaction or poses
              - Give 0-4: Limited connection or poor visual quality
      
          For landscapes/objects:
              - Give 9-10: Strong viewer connection AND clear subject focus
              - Give 7-8: Clear appeal with good technical execution
              - Give 5-6: Standard viewer engagement
              - Give 0-4: Limited engagement or poor clarity
      
      3. Impact & Memorability
          - Give 9-10: Exceptional moments WITH technical excellence
          - Give 7-8: Strong emotional connection and good clarity
          - Give 5-6: Pleasant but ordinary moments
          - Give 0-4: Generic scenes or poor technical quality
          Note: Even humorous moments must maintain visual clarity to score high
      
      4. Visual Poetry
          - Give 9-10: Perfect capture of a mood AND technical excellence
          - Give 7-8: Strong artistic elements with good clarity
          - Give 5-6: Basic aesthetic appeal
          - Give 0-4: Limited artistic impact or poor technical quality

            Format response as JSON:
            {
                "scores": {
                    "atmosphere": <0-10>,
                    "connection": <0-10>,
                    "impact": <0-10>,
                    "poetry": <0-10>
                },
                "reasoning": "<brief explanation for each score>",
                "hasPeople": <boolean>,
                "isHumorous": <boolean>  // flag for funny moments/expressions
            }
        `

    const response = await this.llm.analyzeImageBuffer<{ isHumorous?: boolean }>(buffer, fileType, prompt)
    const scores = response.scores

    let finalScore = scores.atmosphere * 0.3 + scores.connection * 0.25 + scores.impact * 0.25 + scores.poetry * 0.2

    // Extra boost for funny moments
    if (response.isHumorous) {
      finalScore = Math.min(finalScore * 1.2, 10) // 20% boost for humor
    }

    return {
      score: finalScore,
      reasoning: response.reasoning + (response.isHumorous ? ' (Bonus applied for humorous content)' : '')
    }
  }
}
