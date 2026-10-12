import { v2 as cloudinary } from 'cloudinary'
import dotenv from 'dotenv'

dotenv.config()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

console.log('🧪 Testing Cloudinary...')
console.log('   Cloud:', process.env.CLOUDINARY_CLOUD_NAME)

// ============================================================
// TEST 1: Signed Upload (OLD method — probably 403)
// ============================================================
console.log('\n📌 TEST 1: Signed Upload')
try {
  const result = await cloudinary.uploader.upload(
    'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    { folder: 'monal-test' }
  )
  console.log('✅ Signed Upload OK:', result.secure_url)
} catch (err) {
  console.error('❌ Signed Upload FAIL:', err.message, '| HTTP:', err.http_code)
}

// ============================================================
// TEST 2: Unsigned Upload (NEW method — should work)
// ============================================================
console.log('\n📌 TEST 2: Unsigned Upload (preset: monal_unsigned)')
try {
  const result = await cloudinary.uploader.unsigned_upload(
    'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    'monal_unsigned',
    { folder: 'monal-boutique' }
  )
  console.log('✅ Unsigned Upload OK!')
  console.log('   URL:', result.secure_url)
} catch (err) {
  console.error('❌ Unsigned Upload FAIL:', err.message, '| HTTP:', err.http_code)
}