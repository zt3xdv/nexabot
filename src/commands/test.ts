import { Client, ApplicationCommandType, ChatInputCommandInteraction } from "discord.js";

export default {
  category: "utility",
  data: {
    type: ApplicationCommandType.ChatInput,
    name: "test",
    description: "Generate a modern quote card",
    options: [{ type: 3, name: "text", description: "Text", required: false }],
  },

  async execute(interaction: ChatInputCommandInteraction, client: Client) {
    await interaction.deferReply();

    const text = interaction.options.getString("text")?.trim() || "A nice test.";
    const user = interaction.user;
    const avatar = user.displayAvatarURL({ extension: "png", size: 256 });

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body{margin:0;width:1200px;height:630px;display:grid;place-items:center;background:linear-gradient(135deg,#0f172a,#111827);font-family:Inter,sans-serif}
  .c{width:1100px;height:530px;position:relative;border-radius:36px;background:rgba(255,255,255,.06);overflow:hidden;color:#fff;padding:64px 72px;box-sizing:border-box}
  .b{position:absolute;left:36px;top:36px;width:10px;height:458px;border-radius:999px;background:#8b5cf6}
  .top{display:flex;gap:24px;align-items:center}
  .a{width:140px;height:140px;border-radius:50%;border:4px solid rgba(139,92,246,.8)}
  .n{font-size:34px;font-weight:700}
  .t{font-size:22px;color:rgba(255,255,255,.65);margin-top:6px}
  .q{margin-top:42px;font-size:40px;font-weight:600;line-height:1.25;white-space:pre-wrap}
  .f{position:absolute;left:72px;bottom:40px;font-size:20px;color:rgba(255,255,255,.55)}
</style>
</head>
<body>
  <div class="c">
    <div class="b"></div>
    <div class="top">
      <img class="a" src="${avatar}" />
      <div><div class="n">${user.globalName ?? user.username}</div><div class="t">@${user.username}</div></div>
    </div>
    <div class="q">“${text}”</div>
    <div class="f">test • quote card</div>
  </div>
</body>
</html>`;

    const res = await fetch("https://hcti.io/v1/image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${process.env.HCTI_USER}:${process.env.HCTI_KEY}`).toString("base64")}`,
      },
      body: JSON.stringify({ html, google_fonts: "Inter" }),
    });

    const data = await res.json();
    await interaction.editReply({ content: data.url ?? "Failed to generate image." });
  },
};
