// seedBoth.js
const { exec } = require('child_process');
const path = require('path');

// Run HR seed
exec('node seedHr.js', (error, stdout, stderr) => {
  if (error) {
    console.error(`❌ HR seed error: ${error}`);
    return;
  }
  console.log(stdout);
  if (stderr) console.error(stderr);

  // Run Employee seed
  exec('node seedEmployee.js', (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Employee seed error: ${error}`);
      return;
    }
    console.log(stdout);
    if (stderr) console.error(stderr);
    console.log('✅ Both HR and Employee seeded successfully!');
  });
});