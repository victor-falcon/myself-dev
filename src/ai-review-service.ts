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

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

export class AIReviewService {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private parseDiff(diff: string): DiffFile[] {
    const files: DiffFile[] = [];
    const lines = diff.split("\n");
    let currentFile: DiffFile | null = null;
    let currentHunk: DiffHunk | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // File header
      if (line.startsWith("diff --git")) {
        if (currentFile) {
          files.push(currentFile);
        }
        currentFile = { path: "", hunks: [] };
        continue;
      }

      // File path
      if (line.startsWith("+++ b/") && currentFile) {
        currentFile.path = line.substring(6); // Remove '+++ b/'
        continue;
      }

      // Hunk header
      if (line.startsWith("@@") && currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
        }

        // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match) {
          currentHunk = {
            oldStart: parseInt(match[1], 10),
            oldLines: parseInt(match[2] || "1", 10),
            newStart: parseInt(match[3], 10),
            newLines: parseInt(match[4] || "1", 10),
            content: [],
          };
        }
        continue;
      }

      // Hunk content
      if (
        currentHunk &&
        (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
      ) {
        currentHunk.content.push(line);
      }
    }

    // Add the last file and hunk
    if (currentHunk && currentFile) {
      currentFile.hunks.push(currentHunk);
    }
    if (currentFile) {
      files.push(currentFile);
    }

    return files;
  }

  private mapDiffLineToFileLine(
    diffFiles: DiffFile[],
    filePath: string,
    diffLineNumber: number,
  ): number {
    const file = diffFiles.find((f) => f.path === filePath);
    if (!file) {
      return diffLineNumber; // Fallback to original line number
    }

    // First, try to map the line number as if it's a diff content line number
    let currentDiffLine = 0;

    for (const hunk of file.hunks) {
      let newLineCount = 0;
      let oldLineCount = 0;

      for (let i = 0; i < hunk.content.length; i++) {
        currentDiffLine++;
        const line = hunk.content[i];

        if (currentDiffLine === diffLineNumber) {
          // Calculate the actual file line number based on the line type
          if (line.startsWith("+")) {
            // This is an addition, map to new file line
            return hunk.newStart + newLineCount;
          } else if (line.startsWith("-")) {
            // This is a deletion, map to old file line
            return hunk.oldStart + oldLineCount;
          } else {
            // This is context, map to new file line (context appears in both old and new)
            return hunk.newStart + newLineCount;
          }
        }

        // Count lines for proper mapping
        if (line.startsWith("+") || line.startsWith(" ")) {
          newLineCount++;
        }
        if (line.startsWith("-") || line.startsWith(" ")) {
          oldLineCount++;
        }
      }
    }

    // If not found in diff content, check if it's an old line number from hunk header
    for (const hunk of file.hunks) {
      if (diffLineNumber >= hunk.oldStart && diffLineNumber < hunk.oldStart + hunk.oldLines) {
        // This is an old line number, map it to the corresponding new line number
        const offset = diffLineNumber - hunk.oldStart;
        return hunk.newStart + offset;
      }
    }

    // If not found in old line numbers, check if it's a new line number from hunk header
    for (const hunk of file.hunks) {
      if (diffLineNumber >= hunk.newStart && diffLineNumber < hunk.newStart + hunk.newLines) {
        // This is already a new line number, return as is
        return diffLineNumber;
      }
    }

    return diffLineNumber; // Fallback if not found
  }

  async reviewPR(
    title: string,
    description: string,
    diff: string,
  ): Promise<AIReviewResult> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Parse the diff to get file structure and line mappings
    const diffFiles = this.parseDiff(diff);

    const prompt = `
You are an expert code reviewer. Review this pull request and provide feedback.

PR Title: ${title}
PR Description: ${description}

PR Diff:
${diff}

IMPORTANT: When referencing line numbers in your comments, ALWAYS use the NEW file line numbers (the numbers after the + in the @@ hunk headers). 

For example, if you see "@@ -142,6 +151,6 @@" in the diff:
- The OLD file starts at line 142 (before the changes)
- The NEW file starts at line 151 (after the changes)
- When commenting on code in this section, use line 151 (not 142)

This is crucial because the line numbers you reference will be used to post comments on the actual file, and we need the NEW line numbers to match the current state of the file.

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
- Don't comment on style preferences unless they're significant issues

Comments format:
- Write comments on a human tone.
- Keep comments concise and to the point. A short comment is more likely to be read and acted upon.
- Comments are read be expert devs, avoid over-explaining.
- User friendly language, use abbreviations like "LGTM", "WDY", etc.
- 150 character limit per comment.

Comments examples:
- If a property is missed or empty, just say: "We shoudl set sometthing here" or "We need to add xx prop"
- If a function is too complex, say: "This function seems a bit complex, consider breaking it down for better readability."

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

      // Map diff line numbers to actual file line numbers
      if (aiResult.comments && Array.isArray(aiResult.comments)) {
        aiResult.comments = aiResult.comments.map((comment: AIComment) => ({
          ...comment,
          line: this.mapDiffLineToFileLine(
            diffFiles,
            comment.path,
            comment.line,
          ),
        }));
      }

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
