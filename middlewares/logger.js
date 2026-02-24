function logger(req, res, next) {
  const timestamp = new Date().toLocaleString("id-ID");
  console.log("\n" + "=".repeat(60));
  console.log(`⏰ ${timestamp}`);
  console.log(`📝 ${req.method} ${req.url}`);
  console.log(`🌍 IP: ${req.ip}`);
  if (Object.keys(req.query).length > 0) {
    console.log(`🔍 Query:`, req.query);
  }
  console.log("=".repeat(60));
  next();
}

module.exports = logger;
