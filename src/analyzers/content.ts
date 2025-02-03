import type { ScoreComponent } from '@/analyzers/types'
import type { LLMService } from '@/services/llm'

export class ContentAnalyzer {
  constructor(private llm: LLMService) {}

  async analyzeContent(buffer: Buffer, fileType: string): Promise<ScoreComponent> {
    const prompt = `
    First, assess the technical quality of the image:
    Is the image unintentionally blurry, poorly exposed, or technically flawed?
    If YES, no category can score above 6.5.

    Then analyze the content and provide scores (0-10) for:
        1. Subject Clarity
            For photos with people:
                - Give 9-10: Perfect in every way - focus, lighting, faces crystal clear, it could be framed
                - Give 7-8: Sharp, well-executed shot with clear faces
                - Give 4-6: Main subjects visible but some clarity issues
                - Give 0-3: Major clarity issues or subjects hard to distinguish
                Note: Penalize zoomed-in portraits that lack detail
                Note: Do not penalize intentional background blur (bokeh) that draws attention to subject

            For landscapes, objects, or other subjects:
                - Give 9-10: Perfect technical execution AND compelling subject
                - Give 7-8: Good execution with clear, interesting subject
                - Give 4-6: Subject visible but technical or interest issues
                - Give 0-3: Poor execution or unclear subject
                Note: Technical problems MUST lower the score even if subject is interesting but intentional blur should not

        2. Composition
            For selfies with more than one person/group photos:
                - Give 9-10: Perfect framing, everyone clearly visible, more than one person
                - Give 7-8: Good framing, most faces clearly visible
                - Give 4-6: Some framing issues or obscured faces
                - Give 0-3: Poor framing, many obscured faces
                Note: Add +1.5 points for a selfie with two people
                Note: Penalize selfies with just one person

            For other people photos:
                - Give 9-10: Perfect framing, excellent subject placement
                - Give 7-8: Good framing, subjects well-placed
                - Give 4-6: Basic composition, some framing issues
                - Give 0-3: Poor framing or subject placement


            For landscapes/objects:
                - Give 9-10: Perfect composition AND technical execution
                - Give 7-8: Good composition, effective use of focus/blur if present
                - Give 4-6: Basic/flawed composition OR technical issues
                - Give 0-3: Poor composition AND technical issues
                Note: Score must reflect BOTH artistic merit AND technical quality

        3. Moment/Subject Interest
            For people photos:
                - Give 9-10: Significant moments (celebrations, interactions)
                - Give 7-8: Engaging expressions or interactions
                - Give 5-6: Standard poses or casual moments
                - Give 0-4: Random public band performances, casual/unremarkable moments 
            Note: Generic performances or public entertainment should score low unless capturing something uniquely special

            For other subjects:
                - Give 9-10: Exceptional subject AND perfectly captured
                - Give 7-8: Interesting subject, well captured
                - Give 4-6: Either standard subject OR poorly captured
                - Give 0-4: Standard subject AND poorly captured
                Note: Even special moments (weddings, etc) must be well-captured to score high

        4. Scene Quality
            - Give 9-10: Perfect lighting AND excellent environment/background
            - Give 7-8: Good lighting AND good environment
            - Give 5-6: Issues with either lighting OR environment
            - Give 0-4: Issues with both lighting AND environment

        IMPORTANT: Technical quality MUST be considered in ALL scores.
        A technically poor photo of an interesting subject should NOT receive high scores.
        Dark, blurry, or poorly exposed images should be scored low regardless of content.
        Be more forgiving of images capturing a special moment, like blowing out birthday candles.
        
            Format response as JSON:
            {
                "scores": {
                    "subjectClarity": <0-10>,
                    "composition": <0-10>,
                    "interest": <0-10>,
                    "scene": <0-10>
                },
                "reasoning": "<brief explanation for each score>",
                "hasPeople": <boolean>,
                "isGroupShot": <boolean>,
                "isSelfie": <boolean>,
                "isPeopleMain": <boolean>
            }
        `

    const response = await this.llm.analyzeImageBuffer<{
      hasPeople?: boolean
      isSelfie?: boolean
      isGroupShot?: boolean
      isPeopleMain?: boolean
    }>(buffer, fileType, prompt)

    console.log(response)
    const scores = response.scores
    let reasoning = response.reasoning

    // Calculate base score
    let finalScore = scores.subjectClarity * 0.3 + scores.composition * 0.3 + scores.interest * 0.2 + scores.scene * 0.2

    // Boost for high-quality people photos
    if (response.hasPeople && scores.subjectClarity >= 6 && scores.composition >= 5) {
      // Extra boost for good group selfies
      if ((response.isSelfie || response.isPeopleMain) && response.isGroupShot) {
        const boost = response.isPeopleMain ? 1.5 : 1.35
        reasoning += ` (Group bonus applied: ${boost}x)`
        finalScore = Math.min(finalScore * boost, 10)
      } else {
        finalScore = Math.min(finalScore * 1.2, 10) // 20% boost
      }
    }

    return {
      score: finalScore,
      reasoning,
      isSelfie: response.isSelfie
    }
  }
}
