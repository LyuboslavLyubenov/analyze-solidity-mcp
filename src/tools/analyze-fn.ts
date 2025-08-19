import zod from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

const { analyzeSolidityContract: analyzeContract } = require('./ast-analyzer');

const inputSchema = {
  filePath: zod.string().nonempty(),
  fnToAnalyze: zod.string().nonempty(),
};
const outputSchema = {
  fnCallFlow: zod.string(),
};

type Input = typeof inputSchema;
type Output = typeof outputSchema;

type InputArg = {
  [prop in keyof Input]: zod.infer<Input[prop]>;
};

export default function register(server: McpServer) {
  server.registerTool<Input, Output>(
    "analyze-fn",
    {
      description:
        `Analyzes a Solidity function to provide detailed execution flow, variable interactions, and contextual insights. When users want to understand how a specific function works, debug issues, or see its interactions within the contract, this tool will: 1) Parse the full contract source code, 2) Extract the target function's logic, 3) Show control flow paths, 4) Highlight state changes and external calls. \`filePath\` should be the absolute path to the Solidity contract file, \`fnToAnalyze\` should be the exact function name.`,
      inputSchema,
      outputSchema,
    },
    async (args: InputArg) => {
      console.log("Analyzing function:", args.fnToAnalyze);
      console.log("File path:", args.filePath);

      const analysisResult = analyzeContract(args.filePath, args.fnToAnalyze);
      const fnCallFlow = JSON.stringify(analysisResult.functions);
      
      return {
        structuredContent: {
          fnCallFlow,
        },
        content: [
          {
            type: "text",
            text: fnCallFlow,
          },
        ],
      };
    }
  );
}
