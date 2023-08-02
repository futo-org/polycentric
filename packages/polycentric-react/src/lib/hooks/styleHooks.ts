import { useEffect, useMemo, useState } from 'react'

const tailwindColors = [
  'red-500',
  'yellow-500',
  'green-500',
  'blue-500',
  'indigo-500',
  'purple-500',
  'pink-500',
  'gray-500',
  'red-400',
  'yellow-400',
  'green-400',
  'blue-400',
  'indigo-400',
  'purple-400',
  'pink-400',
  'gray-400',
  'red-300',
]

const hashCode = (str: string) => {
  let hash = 0
  if (str.length === 0) return hash
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Convert to 32bit integer
  }
  return hash
}

export const useRandomColor = (text: string) => {
  const color = useMemo(() => {
    // hash the text
    // use the hash to pick a color
    const hash = hashCode(text)
    return tailwindColors[Math.abs(hash) % tailwindColors.length]
  }, [text])

  return color
}
