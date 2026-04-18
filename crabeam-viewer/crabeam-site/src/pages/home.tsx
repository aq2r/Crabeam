import { motion } from "motion/react";
import { ArrowRight, Download, MonitorPlay, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: MonitorPlay,
    title: "視聴側はURLを開くだけ！",
    description:
      "視聴側は配信側に共有してもらったURLを開くだけで視聴を開始できます。",
  },
  {
    icon: Wifi,
    title: "低遅延な再生",
    description: "WebRTCでp2p通信を行い映像と音声を受信するため、低遅延です。",
  },
  {
    icon: Download,
    title: "アプリ側画質制限なし",
    description:
      "1080p60fpsの高画質な画面共有が可能です。 (ネットワーク環境やPCの性能に依存します)",
  },
];

const steps = [
  {
    step: "01",
    title: "配信用アプリとOBSを準備する",
    body: "配信するためにダウンロードから配信用アプリと、OBSを用意しておきます。",
  },
  {
    step: "02",
    title: "OBSの配信URLを設定する",
    body: "OBSの設定の配信タブから、サービスをWHIPに、宛先サーバーをアプリに表示された配信用URLに設定します。",
  },
  {
    step: "03",
    title: "OBSの出力画質を調整する",
    body: "OBSの設定の出力タブからエンコーダー設定を開きレート制御をCBRに設定し、ビットレートを調整します。1000~10000kbpsあたりをおすすめします。",
  },
  {
    step: "04",
    title: "視聴者へリンクを共有",
    body: "アプリに表示された共有用URLを視聴してもらいたい人に送ります。",
  },
  {
    step: "05",
    title: "視聴開始！",
    body: "後は共有してもらったURLをブラウザで開くだけで視聴できます！",
  },
];

const faqs = [
  {
    q: "視聴するのにアプリは必要ですか？",
    a: "視聴はブラウザだけで行えます。配信を開始するホスト側のみアプリを使用します。",
  },
  {
    q: "どの程度の画質まで設定できますか？",
    a: "OBSの設定を変えることでネットワークやPCの性能が許す限り高画質にできます。",
  },
  {
    q: "音が出ません。",
    a: "視聴ページは初期状態でミュートになっています。プレイヤー上部の Unmute ボタンから音声を有効にしてください。",
  },
  {
    q: "料金はかかりますか？",
    a: "無料です。課金要素もなく完全無料です。",
  },
  {
    q: "何人まで視聴できますか？",
    a: "このアプリは余り大人数の視聴は向いていません。一般的な通信環境で配信側ビットレートを6000kbpsにした時、10人ほどが限界だと思われます。",
  },
];

export function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 -top-48 h-120 w-xl -translate-x-1/2 rounded-full bg-white/6 blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-88 w-88 rounded-full bg-white/4 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <img
              src="/crabeam.png"
              alt="Crabeam"
              className="h-10 w-10 object-contain opacity-95"
            />
            <div>
              <div className="text-lg font-semibold tracking-wide text-white/95">
                Crabeam
              </div>
              <div className="text-xs text-white/40">Screen Sharing App</div>
            </div>
          </div>
        </header>

        <section className="grid min-h-[70vh] items-center gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60"
            >
              Browser viewer + desktop host
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl"
            >
              配信はアプリ + OBSで、
              <br />
              視聴はブラウザで。
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="mt-6 max-w-2xl text-base leading-7 text-white/60 sm:text-lg"
            >
              Crabaem は、ホスト側のデスクトップアプリと、
              視聴者向けのブラウザページを組み合わせた画面共有アプリです。
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Button
                asChild
                size="lg"
                className="bg-white text-black hover:bg-white/90"
              >
                <a href="https://github.com/aq2r/Crabeam/releases">
                  ダウンロード
                  <Download className="ml-2 h-4 w-4" />
                </a>
              </Button>

              <Button
                asChild
                size="lg"
                variant="secondary"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10"
              >
                <a href="#how-to">
                  使い方を見る
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="relative"
          >
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="text-sm text-white/75">Viewer Preview</div>
                <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                  Live
                </div>
              </div>

              <div className="aspect-video bg-black">
                <img
                  src="/crabeam.png"
                  alt="Crabeam Preview"
                  className="h-full w-full object-contain p-10 opacity-85"
                />
              </div>
            </div>
          </motion.div>
        </section>

        <section className="py-8 sm:py-12">
          <div className="grid gap-4 md:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;

              return (
                <Card
                  key={feature.title}
                  className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur-sm"
                >
                  <CardHeader className="pb-3">
                    <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                      <Icon className="h-5 w-5 text-white/85" />
                    </div>
                    <CardTitle className="text-lg font-medium text-white/90">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-7 text-white/55">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section id="how-to" className="py-14 sm:py-20">
          <div className="mb-8">
            <div className="text-sm text-white/40">How it works</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              使い方
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {steps.map((step) => (
              <Card
                key={step.step}
                className="border-white/10 bg-white/5 text-white shadow-none backdrop-blur-sm"
              >
                <CardContent className="pt-6">
                  <div className="text-xs tracking-[0.25em] text-white/35">
                    STEP {step.step}
                  </div>
                  <h3 className="mt-3 text-lg font-medium text-white/90">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-white/55">
                    {step.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="text-sm text-white/45">視聴用リンクの例</div>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm text-white/75">
              https://crabeam.aquaquick.workers.dev/viewer#ticket=aaabbbcccdddeee
            </div>
          </div>
        </section>

        <section className="py-14 sm:py-20">
          <div className="mb-8">
            <div className="text-sm text-white/40">FAQ</div>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Q&A
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {faqs.map((item) => (
              <Card
                key={item.q}
                className="h-full border-white/10 bg-white/5 text-white shadow-none backdrop-blur-sm"
              >
                <CardContent className="p-6">
                  <h3 className="text-base font-medium text-white/90">
                    {item.q}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-white/55">
                    {item.a}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <footer className="border-t border-white/10 py-8 text-sm text-white/35">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <a
                href="/Web-ThirdPartyLicenses.txt"
                className="hover:text-white/60"
              >
                Web Third Party Licenses
              </a>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="/App-ThirdPartyLicenses.html"
                className="hover:text-white/60"
              >
                App Third Party Licenses
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
