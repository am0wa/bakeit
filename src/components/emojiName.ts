export const getEmojiName = (emoji: string, iconSet = 'twemoji') => {
  const name = emoji.includes(':') ? emoji.split(':')[1] : emoji;
  return `${iconSet}:${name}`;
}

export const getEmoji = (emoji: string, monochrome?: boolean) => {
  return getEmojiName(emoji, monochrome ? 'emojione-monotone' : 'twemoji');
}