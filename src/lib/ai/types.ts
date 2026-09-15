export type AIPurpose = 'interview' | 'extract_profile' | 'generate_tags' | 'video_script' | 'sns_caption' | 'hear_request' | 'rank_candidates' | 'edit_profile' | 'cbi_intro'
export type CallContext = { caseId?: string; subjectId?: string; memberId?: string }
export type AIUsage = {
  input_tokens: number; output_tokens: number; cache_creation_tokens: number; cache_read_tokens: number
}
export type AIMessage = { role: 'user' | 'assistant'; content: string }
export type AIInput = CallContext & { purpose: AIPurpose; system: string; maxTokens?: number }
export type ChatInput = AIInput & { messages: AIMessage[]; onText?: (text: string) => void }
export type StructuredInput = AIInput & { prompt: string; schema: Record<string, unknown> }
export type TextInput = AIInput & { prompt: string }
export type RankInput = AIInput & { prompt: string; candidates: { id: string; text: string }[] }
export type AIResponse = { model: string; text: string; usage: AIUsage | null; structured?: unknown; ranking?: string[] }

/** Internal provider adapter. Application callers must use callAI(), including streams. */
export interface AIProvider {
  readonly name: string
  modelForPurpose(purpose: AIPurpose): string
  chat(input: ChatInput): Promise<AIResponse>
  extractStructured(input: StructuredInput): Promise<AIResponse>
  generateText(input: TextInput): Promise<AIResponse>
  rank(input: RankInput): Promise<AIResponse>
}
export type AIRequest =
  | (ChatInput & { operation: 'chat' })
  | (StructuredInput & { operation: 'extractStructured' })
  | (TextInput & { operation: 'generateText' })
  | (RankInput & { operation: 'rank' })
