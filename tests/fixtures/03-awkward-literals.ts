// Literals whose own text is what the selector must quote: apostrophes, backslashes, newlines, unicode, and a long one.
// A selector embeds the value inside [value='…'], so anything here that escapes wrong produces a parse error or a miss.

export const messages = {
  apostrophe: "it's already open",
  backslash: 'C:\\Users\\cache',
  both: "a quote ' and a slash \\ together",
  newline: 'first line\nsecond line',
  unicode: 'naïve — café → 日本語',
  bracket: 'value[0] = match',
}

// Over the 40 character cap the attribute builder applies, so this one cannot be addressed by its value.
export const banner = 'this banner is deliberately longer than the forty character attribute cap'

export const short = 'ok'
