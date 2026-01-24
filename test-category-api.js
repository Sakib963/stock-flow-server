#!/usr/bin/env node

/**
 * API Test Script for Category Details Endpoint
 * 
 * This script tests the enhanced category details API endpoint
 * that returns details, statistics, and activity timeline.
 * 
 * Prerequisites:
 * - Server must be running
 * - Database must have activity_log table
 * - At least one category must exist
 * 
 * Usage:
 *   node test-category-api.js <category-oid> <jwt-token>
 */

const https = require('https');
const http = require('http');

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_ENDPOINT = '/api/v1/configuration/category/get-category-details';

// Get command line arguments
const categoryOid = process.argv[2];
const jwtToken = process.argv[3];

if (!categoryOid || !jwtToken) {
    console.error('\n❌ Missing arguments!\n');
    console.log('Usage: node test-category-api.js <category-oid> <jwt-token>\n');
    console.log('Example:');
    console.log('  node test-category-api.js abc-123-def Bearer eyJhbGc...\n');
    process.exit(1);
}

// Parse URL
const url = new URL(`${API_BASE_URL}${API_ENDPOINT}/${categoryOid}`);
const client = url.protocol === 'https:' ? https : http;

// Request options
const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    headers: {
        'Authorization': jwtToken.startsWith('Bearer ') ? jwtToken : `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
    }
};

console.log('\n🔍 Testing Category Details API\n');
console.log('━'.repeat(60));
console.log(`URL: ${url.toString()}`);
console.log(`Category OID: ${categoryOid}`);
console.log('━'.repeat(60));

// Make request
const req = client.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(`\n📊 Response Status: ${res.statusCode}\n`);
        
        try {
            const response = JSON.parse(data);
            
            if (res.statusCode === 200) {
                console.log('✅ API Call Successful!\n');
                
                // Validate response structure
                console.log('📋 Response Structure Validation:\n');
                
                const hasDetails = response.data && response.data.details;
                const hasStats = response.data && response.data.stats;
                const hasActivity = response.data && response.data.activity;
                
                console.log(`  Details Section:  ${hasDetails ? '✅ Present' : '❌ Missing'}`);
                console.log(`  Stats Section:    ${hasStats ? '✅ Present' : '❌ Missing'}`);
                console.log(`  Activity Section: ${hasActivity ? '✅ Present' : '❌ Missing'}`);
                
                // Display details
                if (hasDetails) {
                    console.log('\n📝 Category Details:');
                    console.log('━'.repeat(60));
                    console.log(`  Name:        ${response.data.details.name}`);
                    console.log(`  Code:        ${response.data.details.category_code}`);
                    console.log(`  Status:      ${response.data.details.status}`);
                    console.log(`  Description: ${response.data.details.description || 'N/A'}`);
                    console.log(`  Created By:  ${response.data.details.created_by}`);
                    console.log(`  Created On:  ${response.data.details.created_on}`);
                }
                
                // Display statistics
                if (hasStats) {
                    console.log('\n📊 Statistics:');
                    console.log('━'.repeat(60));
                    console.log(`  Total Products:        ${response.data.stats.totalProducts}`);
                    console.log(`  Active Products:       ${response.data.stats.activeProducts}`);
                    console.log(`  Inventory Value:       ${response.data.stats.totalInventoryValue}`);
                    console.log(`  Available Quantity:    ${response.data.stats.totalAvailableQuantity || 'N/A'}`);
                    console.log(`  Low Stock Items:       ${response.data.stats.lowStockItems}`);
                    console.log(`  Out of Stock Items:    ${response.data.stats.outOfStockItems}`);
                    console.log(`  Avg Product Price:     ${response.data.stats.averageProductPrice}`);
                }
                
                // Display activity
                if (hasActivity && Array.isArray(response.data.activity)) {
                    console.log('\n📜 Activity Timeline:');
                    console.log('━'.repeat(60));
                    
                    if (response.data.activity.length === 0) {
                        console.log('  ⚠️  No activities recorded yet');
                        console.log('  💡 Tip: Update the category to create activity records');
                    } else {
                        response.data.activity.forEach((activity, index) => {
                            console.log(`\n  ${index + 1}. ${activity.action}`);
                            console.log(`     By:   ${activity.user}`);
                            console.log(`     When: ${activity.date}`);
                            if (activity.description) {
                                console.log(`     Info: ${activity.description}`);
                            }
                        });
                    }
                }
                
                console.log('\n━'.repeat(60));
                console.log('✅ Test Completed Successfully!');
                console.log('━'.repeat(60) + '\n');
                
            } else if (res.statusCode === 404) {
                console.log('❌ Category Not Found\n');
                console.log(`Message: ${response.message || 'No message'}\n`);
                
            } else if (res.statusCode === 401 || res.statusCode === 403) {
                console.log('❌ Authentication Error\n');
                console.log('Please check your JWT token.\n');
                
            } else {
                console.log('❌ API Error\n');
                console.log(JSON.stringify(response, null, 2));
            }
            
        } catch (error) {
            console.error('❌ Failed to parse response:', error.message);
            console.log('\nRaw Response:');
            console.log(data);
        }
    });
});

req.on('error', (error) => {
    console.error('\n❌ Request Failed:', error.message);
    console.log('\n💡 Tips:');
    console.log('  - Make sure the server is running');
    console.log('  - Check if the API URL is correct');
    console.log('  - Verify network connectivity\n');
});

req.end();
