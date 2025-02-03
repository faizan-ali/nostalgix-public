import type { ScoreComponent } from '@/analyzers/types'
import type { LLMService } from '@/services/llm'

export class TechnicalAnalyzer {
  constructor(private llm: LLMService) {}

  async assessQuality(buffer: Buffer, fileType: string): Promise<ScoreComponent> {
    const prompt = `
            Analyze this image's technical qualities and score (0-10) each:

            1. Image Clarity
                - Give 9-10: Main subject is tack sharp, intentional blur (if any) enhances composition
                - Give 7-8: Main subject nearly perfect focus with minimal softness
                - Give 4-6: Noticeable unintentional softness/blur on main subject
                - Give 0-3: Significant unintended blur, camera shake, or noise
                Note: Be very strict with clarity scores. Any unintentional blur should score 6 or below. Artistic background blur (bokeh) should not reduce score if subject is sharp


            2. Exposure & Lighting
                - Give 9-10: Perfect exposure, full detail in shadows and highlights
                - Give 7-8: Good exposure with minor issues
                - Give 4-6: Under/overexposed but subject visible
                - Give 0-3: Severe exposure problems
                Consider: Dynamic range, highlight clipping, shadow detail

            3. Technical Composition
                - Give 9-10: Perfect use of compositional techniques:
                    * Rule of thirds
                    * Leading lines
                    * Balance/symmetry
                    * Proper headroom/lookroom
                    * Clean edges/corners
                    * Bokeh used effectively
                - Give 7-8: Good composition with minor issues
                - Give 4-6: Basic composition, missing key elements
                - Give 0-3: Poor composition, multiple issues

            4. Color Quality
                - Give 9-10: Excellent color accuracy, balance, and harmony
                - Give 7-8: Good color with minor issues
                - Give 4-6: Noticeable color issues but acceptable
                - Give 0-3: Major color problems
                Consider: White balance, saturation, color cast

            IMPORTANT: Any unintended blur, even if slight, must score 6 or lower in clarity. This does not apply to artistic blur (bokeh).
            A score of 7 or above in clarity means the image must be perfectly sharp or have intended bokeh.
            
            Format response as JSON:
            {
                "scores": {
                    "clarity": <0-10>,
                    "lighting": <0-10>,
                    "composition": <0-10>,
                    "color": <0-10>
                },
                "reasoning": "<brief explanation for each score including specific compositional elements present/missing>"
            }
        `

    const response = await this.llm.analyzeImageBuffer(buffer, fileType, prompt)
    const scores = response.scores

    console.log(response)
    const finalScore = scores.clarity * 0.35 + scores.lighting * 0.25 + scores.composition * 0.25 + scores.color * 0.15

    return {
      score: finalScore,
      reasoning: response.reasoning
    }
  }
}
