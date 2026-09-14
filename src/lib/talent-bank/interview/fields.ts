export const INTERVIEW_FIELDS = [
  { field_key: 'display_name', label: '氏名または表示名', description: '紹介に使いたい名前。表示名だけでもよい。', required: true },
  { field_key: 'activities', label: '活動内容', description: '現在どのような活動をしているか。', required: true },
  { field_key: 'can_do', label: 'できること', description: '提供できるスキルや作業。', required: true },
  { field_key: 'accepts_requests', label: '依頼を受けられる内容', description: 'どのような依頼なら受けられるか。受けない場合も明記。', required: true },
  { field_key: 'paid_or_free', label: '有償・無償の条件', description: '有償・無償や費用についての条件。', required: true },
  { field_key: 'areas', label: '活動可能地域', description: '市区町村などの活動範囲。詳しい住所は不要。', required: true },
  { field_key: 'available_times', label: '活動可能時間帯', description: '対応できる曜日や時間帯。', required: true },
  { field_key: 'passion', label: '活動への想い', description: '活動で大切にしていることや想い。', required: true },
  { field_key: 'business_name', label: '屋号・団体名', description: '活動で使う屋号や団体名があれば。', required: false },
  { field_key: 'strengths', label: '得意なこと', description: '特に得意なことや強み。', required: false },
  { field_key: 'experience', label: '経験', description: 'これまでの活動や仕事の経験。', required: false },
  { field_key: 'qualifications', label: '資格等', description: '活動に関係する資格など。', required: false },
  { field_key: 'can_help', label: '協力できること', description: '地域や他の活動に協力できること。', required: false },
  { field_key: 'target_people', label: '対象となる人', description: '活動や支援の対象者。個人を特定する情報は不要。', required: false },
  { field_key: 'current_troubles', label: '現在困っていること', description: '活動を進めるうえで困っていること。', required: false },
  { field_key: 'looking_for', label: '探している人', description: '手伝ってほしい役割やスキル。', required: false },
  { field_key: 'want_to_do_together', label: '一緒にやりたいこと', description: '誰かと一緒に取り組みたい活動。', required: false },
  { field_key: 'future_plans', label: '今後やってみたいこと', description: '今後の活動の希望。', required: false },
  { field_key: 'want_to_connect', label: 'どんな人とつながりたいか', description: '交流したい人の関心や活動分野。', required: false },
  { field_key: 'reason_started', label: '活動を始めた理由', description: '活動を始めたきっかけや背景。', required: false },
] as const
export type FieldKey = typeof INTERVIEW_FIELDS[number]['field_key']
export function isFieldKey(key: string): key is FieldKey {
  return INTERVIEW_FIELDS.some(field => field.field_key === key)
}
