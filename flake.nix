{
  description = "LocalRouter — headless core + dashboard (prebuilt release binary)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      # Bump on every release. Release automation rewrites `version` and the
      # `sha256` values below with the real checksums of the matching
      # `localrouter-<os>-<arch>` asset for the tag (same flow as the Homebrew
      # formula in packaging/homebrew/Formula/localrouter.rb).
      version = "0.1.12";

      # nixpkgs system -> release asset name + sha256 placeholder.
      # sha256s are filled in by release automation (nix-prefetch-url on each asset).
      assets = {
        "x86_64-linux"   = { name = "localrouter-linux-x64";    sha256 = "sha256-jg7B+bez0oGLHUDZF8ROJgU5/f9ftDJxjPElxL6IZvc="; };
        "aarch64-linux"  = { name = "localrouter-linux-arm64";  sha256 = "sha256-Buu42b3RYnve5+iVFs0e/NWJAebuxj3uFgxrL3XO6Jo="; };
        "aarch64-darwin" = { name = "localrouter-darwin-arm64"; sha256 = "sha256-GcdgOn6GH8udgQe7SyzC/ViVdBeYWq8n6iNvIkC4lWM="; };
        "x86_64-darwin"  = { name = "localrouter-darwin-x64";   sha256 = "sha256-Cs9Z6Xq3AnWeRolJ5zLKVg0y/Ft8cvbwTKdCuZH5wiU="; };
      };
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        asset = assets.${system} or (throw "LocalRouter: unsupported system ${system}");

        localrouter = pkgs.stdenv.mkDerivation {
          pname = "localrouter";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/ravencloak-org/LocalRouter/releases/download/v${version}/${asset.name}";
            hash = asset.sha256;
          };

          dontUnpack = true;

          # Prebuilt Bun binary — patch its ELF interpreter/rpath on Linux.
          nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.autoPatchelfHook ];
          buildInputs = pkgs.lib.optionals pkgs.stdenv.isLinux [ pkgs.stdenv.cc.cc.lib ];

          installPhase = ''
            runHook preInstall
            install -Dm755 $src $out/bin/localrouter
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Headless core + dashboard for LocalRouter";
            homepage = "https://github.com/ravencloak-org/LocalRouter";
            mainProgram = "localrouter";
            platforms = builtins.attrNames assets;
            # `claude` CLI is a runtime dependency the user installs separately.
          };
        };
      in
      {
        packages = {
          inherit localrouter;
          default = localrouter;
        };

        apps.default = {
          type = "app";
          program = "${localrouter}/bin/localrouter";
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.bun ]
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ pkgs.swift ];
        };
      })
    // {
      # Optional NixOS service. Enable with: services.localrouter.enable = true;
      nixosModules.localrouter = { config, lib, pkgs, ... }:
        let cfg = config.services.localrouter;
        in {
          options.services.localrouter = {
            enable = lib.mkEnableOption "LocalRouter headless core";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.localrouter;
              description = "LocalRouter package to run.";
            };
            port = lib.mkOption {
              type = lib.types.port;
              default = 8083;
              description = "Port the core binds to (LR_PORT).";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.localrouter = {
              description = "LocalRouter headless core";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];
              environment.LR_PORT = toString cfg.port;
              serviceConfig = {
                ExecStart = lib.getExe cfg.package;
                Restart = "on-failure";
                DynamicUser = true;
              };
            };
          };
        };
    };
}
