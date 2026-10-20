const report_crash = async (request, res) => res.status(200).json({ code: 200, message: "Crash recorded", data: null });

module.exports = report_crash;
