/**
 * 使い方ヘルプの内容（機能ごとの説明・音声・画面写真）。
 * proposals/cidao-help-src/build_help.py が作る。文言を直すときは元の台本（narration.json）を直して作り直すこと。
 * 画像は /public/help/img、音声は /public/help/audio（静的ファイル）。
 */
import type { FeatureKey } from '@/components/features'

export type HelpClip = {
  title: string
  text: string
  audio: string
  seconds: number
  image: string | null
}

export type HelpTopic = {
  slug: string
  emoji: string
  title: string
  /** ホームの機能の色・アイコンと同じ色にしたいときの機能名 */
  feature: FeatureKey | null
  summary: string
  /** 読みがな（読み間違いやすい名前だけ） */
  reading: string | null
  clips: HelpClip[]
  links: { href: string; label: string }[]
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    "slug": "intro",
    "emoji": "🏠",
    "title": "CiDAOとは",
    "feature": null,
    "summary": "印西市の市民が、提案・投票・参加できる無料のサービスです。できることの全体像をご紹介します。",
    "reading": null,
    "clips": [
      {
        "title": "ごあいさつ（CBI）",
        "text": "こんにちは。コミュニティバンク印西、CBIです。これから、印西市民による提案・投票・貢献度のプラットフォーム、シダオを、実際のアプリの画面でご紹介します。画面の一部は、個人情報を守るため、名前や数字をサンプルに置き換えています。",
        "audio": "/help/audio/s01.mp3",
        "seconds": 22,
        "image": "/help/img/home.jpg"
      },
      {
        "title": "CiDAO（シダオ）とは？",
        "text": "シダオは、シチズン・ダオ、市民ダオの略です。市民が提案し、話し合い、投票で決めていく、印西発のデジタルプラットフォームで、スマホのブラウザだけで参加できます。提案する、話し合う、投票する。そして、参加の積み重ねが、貢献度として見えるようになります。運営は、CBIです。",
        "audio": "/help/audio/s02.mp3",
        "seconds": 26,
        "image": null
      },
      {
        "title": "CiDAOの 8つの機能",
        "text": "シダオには、八つの機能があります。提案・投票、イベント、団体さがし、AIマッチング相談、登録メンバー、FreeFree掲示板、貢献度とランキング、そして、イベントの受付です。アプリのインストールは要りません。スマホのブラウザで、すぐに使えます。",
        "audio": "/help/audio/s03.mp3",
        "seconds": 22,
        "image": null
      },
      {
        "title": "すべての入口はホーム画面から",
        "text": "すべての入口は、ホーム画面です。提案・投票、イベント、団体をさがす、メンバー、掲示板、ランキング、AIに相談へ、ワンタップで進めます。画面の下のメニューから、ホーム、団体、予定、掲示板へ、いつでも移動できます。右上のベルには、新着のお知らせが届きます。団体とイベントは、登録なしで見られます。",
        "audio": "/help/audio/s04.mp3",
        "seconds": 29,
        "image": "/help/img/home.jpg"
      }
    ],
    "links": [
      {
        "href": "/",
        "label": "ホームを開く"
      }
    ]
  },
  {
    "slug": "start",
    "emoji": "📱",
    "title": "登録のしかた",
    "feature": null,
    "summary": "LINEでログインするだけ。パスワードは要りません。約3分・無料です。",
    "reading": null,
    "clips": [
      {
        "title": "はじめかたは、かんたん3ステップ",
        "text": "はじめかたは、かんたんな三ステップです。一つ目は、ラインでログイン。参加のお約束に同意して、ラインアカウントでログインするだけです。パスワードは要りません。二つ目は、プロフィールづくり。できること、興味のあることを登録すると、団体から声がかかります。三つ目は、参加してみること。気になる提案に投票し、イベントに参加し、地元のお店を応援しましょう。",
        "audio": "/help/audio/s19.mp3",
        "seconds": 32,
        "image": null
      }
    ],
    "links": [
      {
        "href": "/login",
        "label": "LINEでログイン（登録）"
      }
    ]
  },
  {
    "slug": "safety",
    "emoji": "🔒",
    "title": "安心して使えます",
    "feature": null,
    "summary": "投票の秘密を守る・個人情報の扱いなど、安心のための決まりごとです。",
    "reading": null,
    "clips": [
      {
        "title": "「安心して参加できる」を最優先に",
        "text": "安心して参加できることを、最優先にしています。投票の秘密を守り、誰がどう投票したかは公開しません。少人数の区分では、内訳を伏せて、個人が推測されないようにしています。プロフィールの公開範囲や、声かけの受け取り方は、自分で選べます。そして、誹謗中傷や、しつこい勧誘などを禁止する、参加のお約束を決めています。",
        "audio": "/help/audio/s20.mp3",
        "seconds": 29,
        "image": null
      }
    ],
    "links": [
      {
        "href": "/bug-report",
        "label": "不具合・ご要望を送る"
      }
    ]
  },
  {
    "slug": "proposals",
    "emoji": "🗳",
    "title": "提案・投票",
    "feature": "proposals",
    "summary": "やってみたいことを提案し、話し合って、投票で決めます。",
    "reading": null,
    "clips": [
      {
        "title": "提案・投票",
        "text": "一つ目の機能は、提案・投票です。市民から寄せられた提案が、一覧に並びます。投票中、議論中、結果のタブで、いま何が話し合われているかが、ひと目でわかります。分野や規模のタグがつき、CBI内部の決めごとは拘束、市への要望などは諮問と、効力も明示します。",
        "audio": "/help/audio/s05.mp3",
        "seconds": 25,
        "image": "/help/img/proposals.jpg"
      },
      {
        "title": "投票はワンタップで",
        "text": "投票は、ワンタップです。大賛成、賛成、保留、反対の、四つから選びます。投票期間中は、選び直しもできます。登録区分ごとの投票状況は、リアルタイムで表示され、五名未満の区分は、内訳を伏せます。誰がどう投票したかは公開されません。大賛成のときだけ、自分から名乗り出ると、提案者に伝わります。",
        "audio": "/help/audio/s06.mp3",
        "seconds": 30,
        "image": "/help/img/vote.jpg"
      },
      {
        "title": "提案は、こう決まる",
        "text": "提案は、こう決まります。思いつきで終わらせず、話し合ってから決めるための流れです。まず、提案を投稿し、分野や種類を選びます。次に、四十八時間の議論期間で、質問と回答を重ねて、内容をみがきます。その後、投票期間です。締切は、提案者が指定でき、指定がなければ四半期の末日です。結果は、登録区分ごとの内訳まで公開されます。",
        "audio": "/help/audio/s07.mp3",
        "seconds": 34,
        "image": null
      },
      {
        "title": "「なりすまし」を防ぐ、投票の重み",
        "text": "投票には、重みがあります。登録の確かさに応じて、一票の重みが変わる、なりすまし対策です。ライト登録は、れいてんいち。通常登録は、れいてんさん。本人確認が済んだ市民は、満票のいってんゼロです。確認のしくみは、将来の予定です。気軽に始めて、あとから重みを上げられます。重みは集計上のもので、個人の投票内容は公開されません。",
        "audio": "/help/audio/s08.mp3",
        "seconds": 33,
        "image": null
      }
    ],
    "links": [
      {
        "href": "/proposals",
        "label": "提案・投票を開く"
      }
    ]
  },
  {
    "slug": "events",
    "emoji": "📅",
    "title": "イベントカレンダー",
    "feature": "events",
    "summary": "印西市の市民団体・企業・行政のイベントを、ひとつのカレンダーで。",
    "reading": null,
    "clips": [
      {
        "title": "印西市のイベントがひとつのカレンダーに",
        "text": "二つ目の機能は、イベントです。印西市の、市民団体、企業、行政、個人が主催するイベントを、ひとつのカレンダーにまとめて掲載しています。カレンダーとリストを切り替えられ、名前、場所、主催団体、説明で検索できます。オンライン限定の絞り込みも、できます。ログインすれば、自分のイベントも登録できます。",
        "audio": "/help/audio/s09.mp3",
        "seconds": 28,
        "image": "/help/img/events.jpg"
      },
      {
        "title": "地域の行事も、そのまま見られる",
        "text": "たとえば、図書館の、光堂の竜、原画展。開催日時、場所、主催者、参加費が整理されて表示され、チラシの画像も、そのまま見られます。チラシを投稿した人が申告すると、情報提供として、貢献度のポイントもつきます。イベントへの参加の記録も、貢献度に反映されます。",
        "audio": "/help/audio/s10.mp3",
        "seconds": 25,
        "image": "/help/img/event-detail.jpg"
      }
    ],
    "links": [
      {
        "href": "/events",
        "label": "イベントを開く"
      }
    ]
  },
  {
    "slug": "orgs",
    "emoji": "🏢",
    "title": "団体をさがす",
    "feature": "orgs",
    "summary": "市内250あまりの団体を、まとめて探せます。",
    "reading": null,
    "clips": [
      {
        "title": "市内の団体をまとめて検索",
        "text": "三つ目の機能は、団体さがしです。市内の、市民活動団体、事業者、行政まで、二百五十団体あまりを、横断して探せます。分野や市の登録の有無などで絞り込めるので、何か始めたいと思ったとき、受け皿がすぐに見つかります。",
        "audio": "/help/audio/s11.mp3",
        "seconds": 20,
        "image": "/help/img/orgs.jpg"
      },
      {
        "title": "団体には「顔」ができる",
        "text": "団体には、顔ができます。紹介文、連絡先、活動カレンダーが、ひとつのページにまとまります。市の登録番号も表示して、信頼性を高めています。ページの、加入から、参加を申し込めます。複数の団体に所属しても大丈夫です。",
        "audio": "/help/audio/s12.mp3",
        "seconds": 22,
        "image": "/help/img/org-page.jpg"
      }
    ],
    "links": [
      {
        "href": "/orgs",
        "label": "団体をさがす"
      }
    ]
  },
  {
    "slug": "match",
    "emoji": "🤖",
    "title": "AIに相談",
    "feature": "match",
    "summary": "検索が苦手でも大丈夫。会話するだけで、合う活動先を提案します。",
    "reading": null,
    "clips": [
      {
        "title": "AIに相談して、「出番」を見つける",
        "text": "四つ目の機能は、AIマッチング相談です。検索が苦手でも大丈夫。AIエージェントのエーセブンと会話するだけで、あなたに合う活動先を提案します。たとえば、平日の昼間に、一、二時間だけ動けます、何ができそう。子ども向けの活動を手伝える団体はある。団体さがしと、メンバーさがしの、両方に対応し、答えの根拠は、公開されている情報だけです。",
        "audio": "/help/audio/s13.mp3",
        "seconds": 32,
        "image": "/help/img/match.jpg"
      }
    ],
    "links": [
      {
        "href": "/match",
        "label": "AIに相談する"
      }
    ]
  },
  {
    "slug": "talent",
    "emoji": "🤝",
    "title": "登録メンバー",
    "feature": "talent",
    "summary": "スキルや経験を登録して、活躍の場とつながります。",
    "reading": null,
    "clips": [
      {
        "title": "スキルと経験を、まちの力に",
        "text": "五つ目の機能は、登録メンバーです。スキルや資格、経歴、できそうな貢献を登録して、活躍の場とつながります。対応できる時間帯も書けます。団体側から声がかかるしくみで、受け取り方は、誰からでも、AIマッチング経由だけ、受け付けない、から選べます。公開範囲も、自分で選べます。",
        "audio": "/help/audio/s14.mp3",
        "seconds": 26,
        "image": "/help/img/talent.jpg"
      }
    ],
    "links": [
      {
        "href": "/talent",
        "label": "登録メンバーを見る"
      }
    ]
  },
  {
    "slug": "freefree",
    "emoji": "📣",
    "title": "FreeFree地域応援掲示板",
    "feature": "freefree",
    "summary": "印西の小さなお店・団体・企業・行政の「知ってほしい」を、みんなで応援します。",
    "reading": "ふれーふれー ちいき おうえん けいじばん",
    "clips": [
      {
        "title": "FreeFree地域応援掲示板",
        "text": "六つ目の機能は、FreeFree、地域応援掲示板です。印西の小さなお店、個人事業、団体、企業、行政の、知ってほしいを掲載し、みんなで応援します。食、物販、教育、習い事、手仕事、暮らし、起業、イベント、ボランティアの、カテゴリ別です。応援ボタンとコメントで、反応が届きます。",
        "audio": "/help/audio/s15.mp3",
        "seconds": 28,
        "image": "/help/img/freefree.jpg"
      }
    ],
    "links": [
      {
        "href": "/freefree",
        "label": "掲示板を開く"
      }
    ]
  },
  {
    "slug": "ranking",
    "emoji": "⭐",
    "title": "貢献度",
    "feature": "ranking",
    "summary": "投票・提案・コメント・イベント参加などで、ポイントがたまります。",
    "reading": null,
    "clips": [
      {
        "title": "参加の積み重ねが「貢献度」になる",
        "text": "七つ目の機能は、貢献度です。投票、提案、コメント、イベント参加などで、ポイントがたまります。たとえば、拘束的な投票は三ポイント、諮問的な投票は二ポイント。十回投票などの、達成バッジもあります。ランキングへの掲載は、希望した人だけです。将来は、貢献度を地域で活かす構想もありますが、検討の段階です。",
        "audio": "/help/audio/s16.mp3",
        "seconds": 30,
        "image": "/help/img/ranking.jpg"
      }
    ],
    "links": [
      {
        "href": "/ranking",
        "label": "貢献度を見る"
      }
    ]
  },
  {
    "slug": "reception",
    "emoji": "🎫",
    "title": "イベント受付",
    "feature": null,
    "summary": "団体のイベントの出席確認を、スマホ1台でできます。会員証のQRを読むだけです。",
    "reading": null,
    "clips": [
      {
        "title": "団体企画のイベント受付もスマホ1台で",
        "text": "八つ目の機能は、イベントの受付です。団体ページから、受付モードを開くだけ。イベント当日の出席確認を、紙の名簿なしで記録できます。承認済みのメンバーや管理者が、団体ページから起動します。参加者は、自分の会員証のキューアールコードを見せるだけ。受付の履歴は、シーエスブイでダウンロードもできます。",
        "audio": "/help/audio/s17.mp3",
        "seconds": 28,
        "image": "/help/img/reception-1.jpg"
      },
      {
        "title": "QRを読むだけで出席が記録される",
        "text": "カメラを起動して、会員証のキューアールコードをかざすだけで、出席が記録されます。イベントを選んで受付すると、出席として、貢献度のポイントも自動でつきます。キューアールコードが使えない相手には、名前検索で受付できます。受付は、その場で、本日の受付の一覧に反映されます。",
        "audio": "/help/audio/s18.mp3",
        "seconds": 25,
        "image": "/help/img/reception-2.jpg"
      }
    ],
    "links": [
      {
        "href": "/orgs",
        "label": "団体ページを開く"
      }
    ]
  },
  {
    "slug": "3d",
    "emoji": "🦢",
    "title": "3D MAP",
    "feature": null,
    "summary": "白鳥になって印西の空を飛び、50か所の文化財の精霊を集めます。体験にはCiDAOへの登録が必要です。",
    "reading": null,
    "clips": [
      {
        "title": "3D MAP｜白鳥になって印西の空へ",
        "text": "次は、3D MAP。CBIの3Dワールド印西です。白鳥になって、印西の空を自由に飛べます。コントローラーでも、スマホのタッチでも操作できます。まちにある50か所の文化財を、空から探して、精霊のカードを集めましょう。",
        "audio": "/help/audio/3d-1.mp3",
        "seconds": 22,
        "image": "/help/img/3d-spirit.jpg"
      },
      {
        "title": "3D MAP｜体験のしかた",
        "text": "体験には、CiDAOへの登録が必要です。会場のパソコンの受付で、会員証のQRコードをかざすか、表示名を入力すると、はじめられます。まだ登録していない方は、スタッフにお声がけください。",
        "audio": "/help/audio/3d-2.mp3",
        "seconds": 17,
        "image": "/help/img/3d-venue.jpg"
      }
    ],
    "links": [
      {
        "href": "https://communitybankinzai.github.io/cbi-site/metaverse/",
        "label": "3Dワールド印西を開く"
      }
    ]
  },
  {
    "slug": "about",
    "emoji": "🌱",
    "title": "これから",
    "feature": null,
    "summary": "小さく始めて、みんなで育てていきます。",
    "reading": null,
    "clips": [
      {
        "title": "小さく始めて、みんなで育てる",
        "text": "小さく始めて、みんなで育てていきます。いまは、CBIによる試験運用の段階で、団体とイベントの情報を公開し、提案と投票も始まっています。これからは、団体と市民の登録を広げ、実際の提案と投票を、積み重ねていきます。将来は、行政との連携なども考えていますが、いずれも検討の段階です。決め方そのものも、みんなで決めるのが、市民ダオです。",
        "audio": "/help/audio/s21.mp3",
        "seconds": 32,
        "image": null
      },
      {
        "title": "あなたの一票から、印西は変わりはじめる。",
        "text": "あなたの一票から、印西は変わりはじめます。シダオは、画面のアドレスを開くだけで、どなたでもお使いいただけます。運営は、コミュニティバンク印西、CBI。印西市市民活動団体、登録番号、ゼロハチ、ゼロゼロイチです。お問い合わせは、画面のメールアドレスまで。ご覧いただき、ありがとうございました。",
        "audio": "/help/audio/s22.mp3",
        "seconds": 28,
        "image": null
      }
    ],
    "links": [
      {
        "href": "/",
        "label": "ホームを開く"
      }
    ]
  }
]

export function getHelpTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.slug === slug)
}

/** 各機能のページの見出しから、その機能の使い方へ案内するための対応表 */
export const HELP_SLUG_BY_FEATURE: Partial<Record<FeatureKey, string>> = {
  proposals: 'proposals',
  events: 'events',
  orgs: 'orgs',
  talent: 'talent',
  freefree: 'freefree',
  ranking: 'ranking',
  match: 'match',
}

export function topicSeconds(t: HelpTopic): number {
  return t.clips.reduce((a, c) => a + c.seconds, 0)
}
