/**
 * Seed trial assessment reviewers into the database.
 * Run: npm run seed:trial
 */
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Reviewer = require("../models/Reviewer");

const TRIAL_IMPORTANT_NOTES = [
  { title: "🎯 This is a diagnostic exam", text: "This short assessment helps us understand your current strengths and weaknesses so we can recommend the best study path for you." },
  { title: "⏱️ Soft Timer", text: "A timer is shown for pacing, but this is not a strict timed exam. Focus on answering as accurately as you can." },
  { title: "💡 You can skip questions", text: "Navigate freely and come back to difficult items later." },
  { title: "❌ No negative marking", text: "You won't lose points for wrong answers, so try to answer every question." },
  { title: "📊 Results breakdown", text: "After completion, you'll receive a section-by-section score breakdown to guide your study plan." },
];

const TRIAL_REVIEWERS = [
  {
    slug: "trial-professional",
    type: "trial_assessment",
    access: "free",
    title: "Diagnostic Assessment (Professional Level)",
    description: {
      short: "Quick diagnostic to find your strengths and weaknesses.",
      full: "A 50-item diagnostic assessment covering all exam sections at the Professional level. This helps us identify your strong areas and topics that need more practice.",
    },
    logo: { filename: "cselogo.png", path: "/assets/cselogo.png" },
    details: { items: "50 items", duration: "Approx. 30m", passingRate: null, accessLevel: "Professional" },
    status: "published",
    order: 100, // high order so it doesn't interfere with normal listing
    examConfig: {
      variant: "dynamic",
      examFamily: "cse",
      examLevel: ["professional", "both"],
      totalItems: 50,
      timeLimitSeconds: 1800, // 30 minutes soft timer
      passingThreshold: null, // diagnostic — no pass/fail
      sectionDistribution: [
        { section: "verbal", count: 15 },
        { section: "analytical", count: 17 },
        { section: "numerical", count: 15 },
        { section: "general information", count: 3 },
      ],
      difficultyDistribution: { easy: 30, medium: 50, hard: 20 },
    },
    examDetails: {
      timeFormatted: "00:30:00",
      itemsCount: 50,
      progress: "Not Started",
      bannerImage: null,
      introShort: "Quick diagnostic assessment",
      introFull: "This 50-item assessment covers Verbal, Analytical, Numerical, and General Information sections to diagnose your readiness for the Professional-level Civil Service Exam.",
      applicableFor: "Professional",
      coverage: [
        { subject: "Verbal Ability", itemCount: "15 items", topics: ["Word Meaning", "Sentence Completion", "Error Recognition", "Reading Comprehension", "Paragraph Organization"] },
        { subject: "Analytical Ability", itemCount: "17 items", topics: ["Logical Reasoning", "Pattern Analysis", "Syllogisms", "Data Interpretation"] },
        { subject: "Numerical Ability", itemCount: "15 items", topics: ["Basic Operations", "Word Problems", "Number Series", "Fractions & Percentages"] },
        { subject: "General Information", itemCount: "3 items", topics: ["Philippine Constitution", "R.A. 6713", "General Civic Knowledge"] },
      ],
      coverageEndText: "Questions are sampled across different topics within each section (max 2–3 per topic) for balanced diagnostic coverage.",
      difficultyText: "Difficulty is mixed: 30% Easy, 50% Medium, 20% Hard — designed for diagnosis, not filtering.",
      disclaimer: "This diagnostic assessment is meant to gauge your current level. Results are indicative and should guide further study.",
      importantNotes: TRIAL_IMPORTANT_NOTES,
    },
  },
  {
    slug: "trial-subprofessional",
    type: "trial_assessment",
    access: "free",
    title: "Diagnostic Assessment (Sub-Professional Level)",
    description: {
      short: "Quick diagnostic to find your strengths and weaknesses.",
      full: "A 50-item diagnostic assessment covering all exam sections at the Sub-Professional level. This helps us identify your strong areas and topics that need more practice.",
    },
    logo: { filename: "cselogo.png", path: "/assets/cselogo.png" },
    details: { items: "50 items", duration: "Approx. 30m", passingRate: null, accessLevel: "Sub-Professional" },
    status: "published",
    order: 101,
    examConfig: {
      variant: "dynamic",
      examFamily: "cse",
      examLevel: ["subprofessional", "both"],
      totalItems: 50,
      timeLimitSeconds: 1800, // 30 minutes soft timer
      passingThreshold: null, // diagnostic — no pass/fail
      sectionDistribution: [
        { section: "verbal", count: 15 },
        { section: "clerical", count: 17 },
        { section: "numerical", count: 15 },
        { section: "general information", count: 3 },
      ],
      difficultyDistribution: { easy: 30, medium: 50, hard: 20 },
    },
    examDetails: {
      timeFormatted: "00:30:00",
      itemsCount: 50,
      progress: "Not Started",
      bannerImage: null,
      introShort: "Quick diagnostic assessment",
      introFull: "This 50-item assessment covers Verbal, Clerical, Numerical, and General Information sections to diagnose your readiness for the Sub-Professional-level Civil Service Exam.",
      applicableFor: "Sub-Professional",
      coverage: [
        { subject: "Verbal Ability", itemCount: "15 items", topics: ["Word Meaning", "Sentence Completion", "Error Recognition", "Reading Comprehension", "Paragraph Organization"] },
        { subject: "Clerical Ability", itemCount: "17 items", topics: ["Alphabetizing", "Record Keeping", "Following Instructions", "Attention to Detail"] },
        { subject: "Numerical Ability", itemCount: "15 items", topics: ["Basic Operations", "Word Problems", "Number Series", "Fractions & Percentages"] },
        { subject: "General Information", itemCount: "3 items", topics: ["Philippine Constitution", "R.A. 6713", "General Civic Knowledge"] },
      ],
      coverageEndText: "Questions are sampled across different topics within each section (max 2–3 per topic) for balanced diagnostic coverage.",
      difficultyText: "Difficulty is mixed: 30% Easy, 50% Medium, 20% Hard — designed for diagnosis, not filtering.",
      disclaimer: "This diagnostic assessment is meant to gauge your current level. Results are indicative and should guide further study.",
      importantNotes: TRIAL_IMPORTANT_NOTES,
    },
  },
];

async function seed() {
  await connectDB();

  console.log("🗑  Clearing existing trial assessment reviewers...");
  await Reviewer.deleteMany({ type: "trial_assessment" });

  console.log("📝  Inserting trial assessment reviewers...");
  const docs = await Reviewer.insertMany(TRIAL_REVIEWERS);
  console.log(`✅  ${docs.length} trial assessment reviewers seeded successfully!`);

  console.log("\n📋  Trial Assessment Reviewer ID mapping:");
  docs.forEach((d) => console.log(`   ${d.slug}  →  ${d._id}`));

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌  Seeding failed:", err);
  process.exit(1);
});
