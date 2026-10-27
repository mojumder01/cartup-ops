// Text for JSZip, as UTF-8 bytes. JSZip 3.10 turns a text into UTF-8 in
// 16,384-character pieces, and an emoji (two UTF-16 halves) that falls on a
// piece edge is written as two invalid halves — Excel then can't read that
// sheet and opens it empty (Bangla descriptions full of emojis hit it). So
// every text goes to JSZip already encoded, in one piece.
const encoder = new TextEncoder()
export const utf8 = text => encoder.encode(String(text))
