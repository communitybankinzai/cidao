import { describe, expect, it } from 'vitest'
import {
  BROADCAST_TOPICS,
  broadcastChannel,
  findBroadcastTopic,
  splitBroadcastRecipients,
} from '../broadcast-notify-prefs'

describe('broadcastChannel', () => {
  it('未設定は、その種類の初期の届け方（これまでの動き）', () => {
    expect(broadcastChannel({}, 'notify_org_new')).toBe('push')
    expect(broadcastChannel(null, 'notify_proposal')).toBe('push')
    expect(broadcastChannel(undefined, 'notify_member_new')).toBe('push')
    expect(broadcastChannel({}, 'notify_org_update')).toBe('bell')
  })

  it('選んだ届け方を返す', () => {
    expect(broadcastChannel({ notify_org_new: 'bell' }, 'notify_org_new')).toBe('bell')
    expect(broadcastChannel({ notify_org_new: 'off' }, 'notify_org_new')).toBe('off')
    expect(broadcastChannel({ notify_org_new: 'push' }, 'notify_org_new')).toBe('push')
  })

  it('知らない値は初期の届け方にする', () => {
    expect(broadcastChannel({ notify_org_new: 'yes' }, 'notify_org_new')).toBe('push')
    expect(broadcastChannel({ notify_org_new: false }, 'notify_org_new')).toBe('push')
  })

  it('スマホを鳴らさない種類では push を選べない（初期のベルだけになる）', () => {
    expect(broadcastChannel({ notify_org_update: 'push' }, 'notify_org_update')).toBe('bell')
    expect(broadcastChannel({ notify_org_update: 'off' }, 'notify_org_update')).toBe('off')
  })

  it('ほかの種類の設定に引きずられない', () => {
    expect(broadcastChannel({ notify_org_new: 'off' }, 'notify_proposal')).toBe('push')
  })
})

describe('splitBroadcastRecipients', () => {
  const members = [
    { id: 'a', contact_preferences: {} },
    { id: 'b', contact_preferences: { notify_org_new: 'bell' } },
    { id: 'c', contact_preferences: { notify_org_new: 'off' } },
    { id: 'd', contact_preferences: null },
    { id: 'e', contact_preferences: { notify_org_new: 'push' } },
  ]

  it('受け取らない人を外し、ベルだけの人はスマホを鳴らさない', () => {
    expect(splitBroadcastRecipients(members, 'notify_org_new')).toEqual({
      bellIds: ['a', 'b', 'd', 'e'],
      pushIds: ['a', 'd', 'e'],
    })
  })

  it('送る側がベルのみと決めた通知は、だれのスマホも鳴らさない', () => {
    expect(splitBroadcastRecipients(members, 'notify_org_new', false)).toEqual({
      bellIds: ['a', 'b', 'd', 'e'],
      pushIds: [],
    })
  })
})

describe('BROADCAST_TOPICS', () => {
  it('初期の届け方は、その種類で選べる届け方に含まれる', () => {
    for (const t of BROADCAST_TOPICS) expect(t.channels).toContain(t.defaultChannel)
  })

  it('どの種類も「受け取らない」を選べる', () => {
    for (const t of BROADCAST_TOPICS) expect(t.channels).toContain('off')
  })

  it('キーが重ならない', () => {
    const keys = BROADCAST_TOPICS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('知らないキーは見つからない', () => {
    expect(findBroadcastTopic('notify_event')).toBeUndefined()
  })
})
