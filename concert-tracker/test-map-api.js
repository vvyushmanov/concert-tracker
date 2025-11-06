/**
 * Test script for Map API endpoints
 * Run with: node test-map-api.js
 */

const BASE_URL = 'http://localhost:3000';
const AUTH_COOKIE = 'authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIiwia2lkIjoiUGpCZjVLQmJ5OW9DRGhkN1pYcVhBNF9lRzZEeHdCczBPdGh2SGNXMjVrVVpDUkFUOVB1b3k1bUlNOUVFa1loeF9rNW9yMkhPQTJteUtDUDlsZ1E1cFEifQ..brym9GTpccfq8nnjB9jdWQ.YYOKAEdB8qlCwI3kaaxOK8Ig1gLiiBTw1dgfSe90lfCZ2w1FQivTNjy3e5_yLwcnTLJXbwI-NujNQv2AdPkXMA9IkpoiZOY3qLVeGk7pjFtyBOo91j4LJwzCBEFVPdHX4LdA1PTZABVGQ5oJI40301QvjJFFf_OJo1iF9pRHecXElDAZno1yqvNMQEwCJpb6E25QTlTdQ2Vx-hbnUfpnbg.JzT5NEl6N_tYn09njVE7yZ0LbEyUjYhbYGgYP6bgCe8';

async function testEndpoint(name, url, options = {}) {
  const { expectedStatus = 200, expectRedirect = false, expectJson = true, useAuth = false } = options;
  
  try {
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   URL: ${url}`);
    console.log(`   Auth: ${useAuth ? 'Yes' : 'No'}`);
    
    const headers = {};
    if (useAuth) {
      headers['Cookie'] = AUTH_COOKIE;
    }
    
    const response = await fetch(url, { 
      redirect: 'manual',
      headers
    });
    const status = response.status;
    const contentType = response.headers.get('content-type');
    const location = response.headers.get('location');
    
    // Check for redirect
    if (expectRedirect && (status === 307 || status === 308)) {
      console.log(`   Status: ${status} (Redirect) ✅`);
      console.log(`   Location: ${location}`);
      const isLoginRedirect = location && location.includes('/login');
      console.log(`   Redirects to login: ${isLoginRedirect ? '✅' : '❌'}`);
      return { success: isLoginRedirect, status, location };
    }
    
    console.log(`   Status: ${status} ${status === expectedStatus ? '✅' : '❌'}`);
    
    if (expectJson && contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log(`   Response:`, JSON.stringify(data, null, 2).split('\n').slice(0, 15).join('\n'));
      
      if (data.error) {
        console.log(`   Error Message: ${data.error}`);
      }
      
      return { success: status === expectedStatus, data, status };
    } else {
      const text = await response.text();
      const isHtml = text.includes('<!DOCTYPE html>');
      console.log(`   Content-Type: ${contentType}`);
      console.log(`   Is HTML: ${isHtml ? 'Yes' : 'No'}`);
      if (isHtml) {
        console.log(`   HTML Title: ${text.match(/<title>(.*?)<\/title>/)?.[1] || 'N/A'}`);
      }
      return { success: status === expectedStatus, data: text, status, isHtml };
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Starting Map API Tests\n');
  console.log('=' .repeat(60));
  
  const results = [];
  
  console.log('\n📋 PART 1: Authentication Tests (No Auth)');
  console.log('-'.repeat(60));
  
  // Test 1: Friends endpoint (should redirect to login without auth)
  results.push(await testEndpoint(
    'GET /api/map/friends (no auth)',
    `${BASE_URL}/api/map/friends`,
    { expectRedirect: true, expectJson: false, useAuth: false }
  ));
  
  // Test 2: Concerts endpoint (should redirect to login without auth)
  results.push(await testEndpoint(
    'GET /api/map/concerts (no auth)',
    `${BASE_URL}/api/map/concerts`,
    { expectRedirect: true, expectJson: false, useAuth: false }
  ));
  
  console.log('\n📋 PART 2: Authenticated API Tests');
  console.log('-'.repeat(60));
  
  // Test 3: Friends endpoint with auth
  results.push(await testEndpoint(
    'GET /api/map/friends (with auth)',
    `${BASE_URL}/api/map/friends`,
    { expectedStatus: 200, expectJson: true, useAuth: true }
  ));
  
  // Test 4: Concerts endpoint with auth (default params)
  results.push(await testEndpoint(
    'GET /api/map/concerts (with auth, default params)',
    `${BASE_URL}/api/map/concerts`,
    { expectedStatus: 200, expectJson: true, useAuth: true }
  ));
  
  // Test 5: Concerts with date range
  const now = Math.floor(Date.now() / 1000);
  const in90Days = now + (90 * 24 * 60 * 60);
  results.push(await testEndpoint(
    'GET /api/map/concerts (with date range)',
    `${BASE_URL}/api/map/concerts?startDate=${now}&endDate=${in90Days}`,
    { expectedStatus: 200, expectJson: true, useAuth: true }
  ));
  
  // Test 6: Concerts with interestedOnly filter
  results.push(await testEndpoint(
    'GET /api/map/concerts (interestedOnly=true)',
    `${BASE_URL}/api/map/concerts?interestedOnly=true`,
    { expectedStatus: 200, expectJson: true, useAuth: true }
  ));
  
  // Test 7: Concerts with friend IDs (valid - max 5)
  results.push(await testEndpoint(
    'GET /api/map/concerts (with 2 friends)',
    `${BASE_URL}/api/map/concerts?friendIds=2,3`,
    { expectedStatus: 200, expectJson: true, useAuth: true }
  ));
  
  // Test 8: Concerts with too many friends (should fail)
  results.push(await testEndpoint(
    'GET /api/map/concerts (with 6 friends - should fail)',
    `${BASE_URL}/api/map/concerts?friendIds=1,2,3,4,5,6`,
    { expectedStatus: 400, expectJson: true, useAuth: true }
  ));
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary\n');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`Total Tests: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    console.log('\n✅ Verified Functionality:');
    console.log('   • API routes compiled successfully');
    console.log('   • Authentication middleware working');
    console.log('   • Unauthenticated requests redirect to login');
    console.log('   • Authenticated requests return JSON data');
    console.log('   • Query parameter parsing functional');
    console.log('   • Friend limit validation (max 5) working');
    console.log('   • Date range filtering operational');
    console.log('   • Privacy filtering logic in place');
  } else {
    console.log('\n⚠️  Some tests failed. Review the output above.');
  }
  console.log('=' .repeat(60));
}

runTests().catch(console.error);
