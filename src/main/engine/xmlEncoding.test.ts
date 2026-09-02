import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectXmlEncoding, decodeXmlBuffer } from './xmlEncoding.ts'

test('detecta o encoding declarado no prólogo do XML', () => {
  assert.equal(
    detectXmlEncoding(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a/>', 'latin1')),
    'iso-8859-1'
  )
  assert.equal(detectXmlEncoding(Buffer.from('<?xml version="1.0" encoding="UTF-8"?><a/>')), 'utf-8')
})

test('assume UTF-8 quando não há declaração de encoding', () => {
  assert.equal(detectXmlEncoding(Buffer.from('<nfeProc><NFe/></nfeProc>')), 'utf-8')
})

test('BOM de UTF-8 tem precedência sobre qualquer declaração', () => {
  const buf = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a/>')
  ])
  assert.equal(detectXmlEncoding(buf), 'utf-8')
})

test('decodifica ISO-8859-1 preservando acentos da razão social', () => {
  // Um XML Latin-1 real: "CONSTRUÇÃO" tem bytes que não formam UTF-8 válido.
  const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><emit><xNome>CONSTRUÇÃO LTDA</xNome></emit>'
  const buf = Buffer.from(xml, 'latin1')

  assert.match(decodeXmlBuffer(buf), /CONSTRUÇÃO LTDA/)
  assert.ok(
    !buf.toString('utf8').includes('CONSTRUÇÃO LTDA'),
    'decodificar como UTF-8 corromperia o texto — é justamente o que a função evita'
  )
})

test('decodifica UTF-8 normalmente e remove o BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<a>ção</a>', 'utf8')])
  const decoded = decodeXmlBuffer(buf)
  assert.equal(decoded, '<a>ção</a>')
  assert.notEqual(decoded.charCodeAt(0), 0xfeff)
})

test('encoding desconhecido não lança — cai para UTF-8', () => {
  const buf = Buffer.from('<?xml version="1.0" encoding="INEXISTENTE-42"?><a>ok</a>')
  assert.match(decodeXmlBuffer(buf), /<a>ok<\/a>/)
})

test('a chave de acesso é legível em qualquer um dos encodings', () => {
  // Garantia de que a mudança de decodificação não afeta a localização da chave (tudo ASCII).
  const key = '35240612345678000190550010000012341123456789'
  const latin1 = Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?><infNFe Id="NFe${key}"/>`, 'latin1')
  const utf8 = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><infNFe Id="NFe${key}"/>`, 'utf8')

  assert.match(decodeXmlBuffer(latin1), new RegExp(key))
  assert.match(decodeXmlBuffer(utf8), new RegExp(key))
})
