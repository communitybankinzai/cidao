import { describe, expect, it } from 'vitest'
import { parsePlaceTag, placeTagLabel, seniorPlaceColumns, seniorPlaceInitialInput } from '../senior-place'

describe('?tag= の読み取り（子ども＋高齢者）', () => {
  it('senior と、子どもの居場所の値だけ通す', () => {
    expect(parsePlaceTag('senior')).toBe('senior')
    expect(parsePlaceTag(['senior', 'kodomo'])).toBe('senior')
    expect(parsePlaceTag('kodomo')).toBe('kodomo')
    expect(parsePlaceTag('ibasho')).toBe('ibasho')
    expect(parsePlaceTag('oyako')).toBe('oyako')
    expect(parsePlaceTag('SENIOR')).toBeNull()
    expect(parsePlaceTag('other')).toBeNull()
    expect(parsePlaceTag(undefined)).toBeNull()
  })

  it('表示名', () => {
    expect(placeTagLabel('senior')).toBe('高齢者の居場所')
    expect(placeTagLabel('kodomo')).toBe('子どもの居場所')
    expect(placeTagLabel('oyako')).toBe('親子が集まる場')
  })
})

describe('フォームの値から保存する列を決める', () => {
  it('人が選んだときだけ列を返す（自動のときは何も触らない）', () => {
    expect(seniorPlaceColumns('yes')).toEqual({ senior_place: true, senior_place_checked: true })
    expect(seniorPlaceColumns('none')).toEqual({ senior_place: false, senior_place_checked: true })
    expect(seniorPlaceColumns('')).toEqual({})
    expect(seniorPlaceColumns(undefined)).toEqual({})
    expect(seniorPlaceColumns('true')).toEqual({})
  })

  it('編集画面の初期値：人が決めた行だけ値を出す', () => {
    expect(seniorPlaceInitialInput({ senior_place: true, senior_place_checked: true })).toBe('yes')
    expect(seniorPlaceInitialInput({ senior_place: false, senior_place_checked: true })).toBe('none')
    expect(seniorPlaceInitialInput({ senior_place: true, senior_place_checked: false })).toBe('')
    expect(seniorPlaceInitialInput({})).toBe('')
  })
})
