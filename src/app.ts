import express from "express";
import contactRoutes from "./routes/contact.routes";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/", contactRoutes);

export default app;
