import { GoogleGenerativeAI } from "@google/generative-ai";

export interface AIReviewResult {
  action: "approve" | "approve_with_comments" | "comment_only";
  comments: AIComment[];
  approvalMessage?: string;
}

export interface AIComment {
  path: string;
  line: number;
  content: string;
  context: string;
}

export class AIReviewService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async reviewPR(
    title: string,
    description: string,
    diff: string,
  ): Promise<AIReviewResult> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are an expert code reviewer. Review this pull request and provide feedback.

PR Title: ${title}
PR Description: ${description}

PR Diff:
${diff}

Please analyze this PR and respond with a JSON object in the following format:
{
  "action": "approve" | "approve_with_comments" | "comment_only",
  "comments": [
    {
      "path": "file/path/example.js",
      "line": 42,
      "content": "Brief comment about the issue",
      "context": "Code snippet showing the issue (3-5 lines around the problem)"
    }
  ],
  "approvalMessage": "Optional message if approving"
}

Guidelines:
- Use "approve" only for very simple changes (typos, minor fixes, documentation)
- Use "approve_with_comments" for good changes that have minor improvements
- Use "comment_only" for changes that need fixes before approval
- Focus on bugs, typos, security issues, performance problems, code quality
- Write comments in a conversational, human tone using questions and suggestions. Use single, direct, and clear comments
- Don't comment on style preferences unless they're significant issues
`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      console.log("🤖 AI Response received, parsing...");

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log("⚠️  No JSON found in AI response, using fallback");
        throw new Error("No JSON found in AI response");
      }

      const aiResult = JSON.parse(jsonMatch[0]);
      console.log("✅ AI review completed successfully");
      return aiResult as AIReviewResult;
    } catch (error) {
      console.error("❌ AI review failed:", error);
      // Fallback to manual review
      return {
        action: "comment_only",
        comments: [
          {
            path: "unknown",
            line: 0,
            content: "AI review failed, please review manually",
            context: "Error occurred during AI analysis",
          },
        ],
      };
    }
  }
}

