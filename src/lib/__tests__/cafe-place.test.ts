import { describe, expect, it } from 'vitest'
import { cafePlaceColumns, cafePlaceInitialInput } from '../cafe-place'
import { parsePlaceTag, placeTagLabel } from '../senior-place'

describe('コミュニティカフェの ?tag=', () => {
  it('cafe を通し、ほかの値は従来どおり', () => {
    expect(parsePlaceTag('cafe')).toBe('cafe')
    expect(parsePlaceTag('senior')).toBe('senior')
    expect(parsePlaceTag('kodomo')).toBe('kodomo')
    expect(parsePlaceTag('Cafe')).toBeNull()
    expect(placeTagLabel('cafe')).toBe('コミュニティカフェ')
  })
})

describe('フォームの値から保存する列を決める', () => {
  it('人が選んだときだけ列を返す', () => {
    expect(cafePlaceColumns('yes')).toEqual({ cafe_place: true, cafe_place_checked: true })
    expect(cafePlaceColumns('none')).toEqual({ cafe_place: false, cafe_place_checked: true })
    expect(cafePlaceColumns('')).toEqual({})
    expect(cafePlaceColumns(null)).toEqual({})
  })

  it('編集画面の初期値：人が決めた行だけ値を出す', () => {
    expect(cafePlaceInitialInput({ cafe_place: true, cafe_place_checked: true })).toBe('yes')
    expect(cafePlaceInitialInput({ cafe_place: false, cafe_place_checked: true })).toBe('none')
    expect(cafePlaceInitialInput({ cafe_place: true, cafe_place_checked: false })).toBe('')
    expect(cafePlaceInitialInput({})).toBe('')
  })
})
