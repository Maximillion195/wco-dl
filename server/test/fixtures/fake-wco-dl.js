// Stand-in for __main__.py: prints its arguments, fails for "fail-me" slugs.
const args = process.argv.slice(2);
console.log(JSON.stringify(args));
if (args.some((arg) => arg.includes('fail-me'))) {
  console.error('Simulated download failure');
  process.exit(2);
}
