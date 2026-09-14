const messages: Record<string, string> = {
  unauthorized: 'ログインし直してください。',
  eligibility_required: '18歳以上の本人・代表者であることを受付画面で確認してください。',
  consent_required: 'インタビューと外部AI利用への同意を確認してください。画面を再読み込みすると同意画面に戻ります。',
  ai_unavailable: '回答は保存しましたが、AIが応答できませんでした。少し待ってから続きを入力するか、「後で続ける」を選んでください。',
  turn_limit: '今回のインタビューは回答回数の上限（40回）に達しました。これまでの内容は保存されています。',
  busy: '回答を処理中です。少し待ってから「保存内容を読み直す」を押してください。処理が中断された場合は5分後に再開できます。',
  conflict: '別の画面で更新されました。保存内容を読み直してください。',
  not_active: 'インタビューは中断または完了しています。保存内容を読み直してください。',
  rate_limited: '操作が続いています。1分ほど待ってからお試しください。',
  invalid_text: '回答は1〜4000文字で入力してください。',
  invalid_request: '入力内容を確認してください。',
  interview_not_found: 'インタビューを開始してください。',
}
export function interviewErrorMessage(reason: string) {
  return messages[reason] ?? '保存状態を確認できませんでした。自動で再送せず、「保存内容を読み直す」で確認してください。'
}
