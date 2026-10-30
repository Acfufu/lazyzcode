require "tmpdir"
require "fileutils"
require "open3"

Dir.mktmpdir("lzy-liquid-") do |dir|
  source = File.join(dir, "source")
  FileUtils.mkdir_p(source)
  # Construct the malformed token here; it is never embedded in a public report.
  File.write(File.join(source, "broken.md"), "---\n---\n" + "{" + "% if %" + "}\n")
  stdout, stderr, status = Open3.capture3("bundle", "exec", "ruby", "-rgithub-pages", "-S", "jekyll", "build", "--source", source, "--destination", File.join(dir, "site"))
  puts stdout, stderr
  abort "Liquid counterexample did not fail for the expected reason" if status.success? || !(stdout + stderr).match?(/Liquid (?:Exception|syntax error)/i)
  puts "PASS: isolated malformed Liquid rejected"
end
