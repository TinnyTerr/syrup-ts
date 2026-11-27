# Builds the upstream Haskell Syrup and ask checkers to wasm and bundles
# them with the TS Tiny Machine into static pages + a zip.
# Needs wasm32-wasi-ghc/cabal (source ~/.ghc-wasm/env), bun, git, zip.

GHC       ?= wasm32-wasi-ghc
CABAL     ?= wasm32-wasi-cabal
LIBDIR    := $(shell $(GHC) --print-libdir)
VENDOR    := vendor
BUILD     := build
OUT       := ../dist/wasm
ZIP       := ../dist/syrup-wasm.zip

SYRUP_GIT ?= https://github.com/pigworker/Syrup.git
ASK_GIT   ?= https://github.com/msp-strath/ask.git
SYRUP_REF ?= origin/HEAD
ASK_REF   ?= origin/HEAD

all: zip

# clone once, `make fetch` to update
$(VENDOR)/Syrup/.git:
	git clone $(SYRUP_GIT) $(VENDOR)/Syrup
$(VENDOR)/ask/.git:
	git clone $(ASK_GIT) $(VENDOR)/ask

fetch: $(VENDOR)/Syrup/.git $(VENDOR)/ask/.git
	git -C $(VENDOR)/Syrup fetch -q origin && git -C $(VENDOR)/Syrup checkout -q --detach $(SYRUP_REF)
	git -C $(VENDOR)/ask fetch -q origin && git -C $(VENDOR)/ask checkout -q --detach $(ASK_REF)

# syrup has hackage deps (blaze-html), so it goes through cabal
$(BUILD)/syrup.wasm: hs/SyrupWasm.hs hs/syrup-wasm.cabal hs/cabal.project $(VENDOR)/Syrup/.git
	mkdir -p $(BUILD)
	cd hs && $(CABAL) build -v0 syrup-wasm
	cp "$$(cd hs && $(CABAL) list-bin -v0 syrup-wasm)" $@

# ask only needs boot packages
$(BUILD)/ask.wasm: hs/AskWasm.hs $(VENDOR)/ask/.git
	mkdir -p $(BUILD)/ask-obj
	$(GHC) hs/AskWasm.hs -i$(VENDOR)/ask/lib -O1 -outputdir $(BUILD)/ask-obj \
	  -no-hs-main -optl-mexec-model=reactor \
	  '-optl-Wl,--export=hs_init,--export=filth' -o $@

$(BUILD)/%.jsffi.js: $(BUILD)/%.wasm
	$(LIBDIR)/post-link.mjs -i $< -o $@

wasm: $(BUILD)/syrup.wasm $(BUILD)/ask.wasm $(BUILD)/syrup.jsffi.js $(BUILD)/ask.jsffi.js

dist: wasm $(wildcard pages/*) $(wildcard ../src/tiny/*.ts)
	rm -rf $(OUT)
	cd .. && bun build --outdir=dist/wasm --minify \
	  wasm/pages/index.html wasm/pages/syrup.html wasm/pages/ask.html wasm/pages/tiny.html

zip: dist
	rm -f $(ZIP)
	cd $(OUT) && zip -qr $(abspath $(ZIP)) .
	@echo "-> $(ZIP)"

serve: dist
	cd $(OUT) && python3 -m http.server 8000

clean:
	rm -rf $(BUILD) hs/dist-newstyle $(OUT) $(ZIP)

distclean: clean
	rm -rf $(VENDOR)

.PHONY: all fetch wasm dist zip serve clean distclean
