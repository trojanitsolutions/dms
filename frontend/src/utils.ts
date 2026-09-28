export const deskLink = (doctype: string, name: string) =>
  `/desk/${doctype.toLowerCase().replace(/ /g, '-')}/${encodeURIComponent(name)}`
