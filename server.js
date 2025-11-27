import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import cors from "cors";
import sharp from "sharp";
import Replicate from "replicate";
import fetch from "node-fetch"; // Replicate 결과 다운로드용

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 정적 폴더
app.use("/generated", express.static(path.join(__dirname, "generated")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(__dirname));

const upload = multer({ dest: "uploads/" });

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// --------------------------------------------------
// 테스트용 OpenAI 라우터 (원하면 남겨둬도 됨)
// --------------------------------------------------
/*
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/test-image", async (req, res) => {
  try {
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt: "flat illustration of a smiling person in pastel colors",
      size: "1024x1024",
    });

    const first = result?.data?.[0];
    const b64 = first?.b64_json;
    if (!b64) return res.json({ ok: false, message: "no image" });

    const buf = Buffer.from(b64, "base64");
    const filename = `img-${Date.now()}.png`;
    fs.writeFileSync(path.join(__dirname, "generated", filename), buf);
    return res.json({ ok: true, url: `/generated/${filename}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});
*/

// --------------------------------------------------
// 📸 실제 촬영된 사진 → 8개 브랜드 스타일 기반 변환
// --------------------------------------------------
app.post("/api/photo-to-brand", upload.single("photo"), async (req, res) => {
  console.log("📸 /api/photo-to-brand called (Replicate + 8 styles)");

  if (!req.file) {
    return res.status(400).json({ ok: false, message: "no file uploaded" });
  }

  const userPhotoPath = req.file.path;
  const gender = req.body?.gender || "neutral";

  try {
    // 1) 8개 스타일 레퍼런스 열기
    const styleImagePaths = Array.from({ length: 8 }, (_, i) =>
      path.join(__dirname, "assets", `BrandRef_0${i + 1}.png`)
    );
    const styleImageStreams = styleImagePaths
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.createReadStream(p));

    if (styleImageStreams.length === 0) {
      throw new Error("No reference style images found in /assets");
    }

const output = await replicate.run(
  "black-forest-labs/flux-1.1-pro",  // ✅ Replicate 공식 공개모델로 변경
  {
    input: {
      prompt: `
        Convert the uploaded webcam photo into our brand’s illustration style.
        Use thin black outline, pure white skin, grayscale clothing.
        Maintain pose and recognizable facial structure.
        Output PNG with transparent background outside character only.
      `,
      // 아래 두 줄은 flux 모델이 인풋으로 받는 항목이라면 그대로 두고,
      // 아니라면 제거 가능
      width: 1024,
      height: 1024,
      // 업로드된 이미지가 있다면 추가
      image: fs.createReadStream(userPhotoPath),
    },
  }
);


    console.log("🟣 Replicate output:", output);

    const imageUrl = Array.isArray(output) ? output[0] : output;

    // 3) 결과 다운로드해서 우리 서버에 저장
    const rawFilename = `char-${Date.now()}.png`;
    const rawPath = path.join(__dirname, "generated", rawFilename);

    const imgRes = await fetch(imageUrl);
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(rawPath, imgBuf);

    // 4) 노이즈 배경과 합성
    const noisePath = path.join(__dirname, "assets", "NoiseBG.png");
    const finalFile = `final-${Date.now()}.png`;
    const finalPath = path.join(__dirname, "generated", finalFile);

    await sharp(noisePath)
      .resize(1024, 1024)
      .composite([{ input: rawPath, gravity: "center" }])
      .toFile(finalPath);

    // 5) 임시파일 정리
    fs.unlink(userPhotoPath, () => {});
    fs.unlink(rawPath, () => {});

    return res.json({ ok: true, url: `/generated/${finalFile}` });
  } catch (err) {
    console.error("🔴 /api/photo-to-brand (Replicate) error:", err);
    fs.unlink(userPhotoPath, () => {});
    return res.status(500).json({ ok: false, message: err.message });
  }
});


// --------------------------------------------------
app.listen(3000, () => {
  console.log("✅ server running at http://localhost:3000");
});
