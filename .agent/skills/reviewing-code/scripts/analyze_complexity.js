/**
 * A simple heuristic script to estimate code complexity.
 * Usage: node analyze_complexity.js <filepath>
 */
const fs = require('fs');

const filePath = process.argv[2];

if (!filePath) {
  console.error("Please provide a file path.");
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').length;
  
  // Heuristic: Count branching keywords
  const branches = (content.match(/(if|for|while|switch|case|catch|&&|\|\||\?)/g) || []).length;
  const complexityScore = branches + 1;

  console.log(JSON.stringify({
    file: filePath,
    lines: lines,
    estimated_complexity: complexityScore,
    rating: complexityScore > 20 ? "High" : complexityScore > 10 ? "Medium" : "Low"
  }, null, 2));

} catch (err) {
  console.error("Error reading file:", err.message);
  process.exit(1);
}
