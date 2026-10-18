import UIKit
import WebKit
import Capacitor

/* School pages inside the TaskM app: the phone version of the TaskM Chrome button.
   The student opens a school site (a class OneNote, Teams, Aeries grades, Outlook) in TaskM's own browser, signs in on
   that site's page and taps "Add to TaskM". TaskM reads the page's text the same way the Chrome button does, so pages
   behind a school sign-in work without the school approving TaskM. Sign-ins stay on the phone, like in Safari, so TaskM
   can quietly read saved pages again later in a hidden reader. TaskM never sees or stores a password.
   The website (connect.js) drives all of this through the "SchoolPage" plugin. */

/// TaskM's main screen: Capacitor's web view showing taskm-school.web.app, plus TaskM's own plugin.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SchoolPagePlugin())
    }
}

/// A web view for school sites. Sign-ins are kept like in Safari, and pages show their full desktop version,
/// since Teams and OneNote send phone browsers to their own apps instead.
private func schoolWebView(_ frames: FrameCollector) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.defaultWebpagePreferences.preferredContentMode = .desktop
    frames.install(in: config)
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.allowsBackForwardNavigationGestures = true
    // An app web view leaves "Version/… Safari/…" out of its user agent, and Teams then calls the browser unsupported
    wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    return wv
}

/// Remembers each frame a page loads (OneNote shows the notebook inside a frame from another site, with menus in the
/// outer page), so TaskM can read the text of all of them.
final class FrameCollector: NSObject, WKScriptMessageHandler {
    private static let name = "taskmFrame"
    private var frames: [String: WKFrameInfo] = [:]

    func install(in config: WKWebViewConfiguration) {
        let js = "try{window.webkit.messageHandlers.\(FrameCollector.name).postMessage(location.href)}catch(e){}"
        config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        config.userContentController.add(WeakHandler(self), name: FrameCollector.name)
    }

    func reset() { frames = [:] }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let f = message.frameInfo
        if f.isMainFrame { return }
        frames[f.request.url?.absoluteString ?? UUID().uuidString] = f
        if frames.count > 60, let k = frames.keys.first { frames.removeValue(forKey: k) }
    }

    /// The address and text of the page and of every frame in it: [{url, text}]
    func read(_ webView: WKWebView, done: @escaping ([[String: String]]) -> Void) {
        let js = "(function(){var b=document.body;return JSON.stringify({u:location.href,t:b?b.innerText:''})})()"
        var out: [[String: String]] = []
        var finished = false
        let group = DispatchGroup()
        func take(_ value: Any?) {
            guard let s = value as? String, let d = s.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: String] else { return }
            out.append(["url": o["u"] ?? "", "text": o["t"] ?? ""])
        }
        func finish() {
            if finished { return }
            finished = true
            done(out)
        }
        group.enter()
        webView.evaluateJavaScript(js) { value, _ in take(value); group.leave() }
        for f in frames.values {
            group.enter()
            webView.evaluateJavaScript(js, in: f, in: .page) { result in
                if case .success(let value) = result { take(value) }
                group.leave()
            }
        }
        group.notify(queue: .main) { finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { finish() }   // a frame that went away never answers
    }
}

/// WKUserContentController keeps its handlers alive; this keeps it from keeping the web view's owner alive too.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

// MARK: - The plugin

@objc(SchoolPagePlugin)
public class SchoolPagePlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "SchoolPagePlugin"
    public let jsName = "SchoolPage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "visit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "frames", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeReader", returnType: CAPPluginReturnPromise),
    ]

    private let collector = FrameCollector()
    private var reader: WKWebView?
    private var loadCall: CAPPluginCall?

    /// Shows TaskM's browser. Resolves {action: "add", url, title, frames} when the student taps Add to TaskM,
    /// or {action: "close"}.
    @objc func open(_ call: CAPPluginCall) {
        let url = URL(string: call.getString("url") ?? "").flatMap { $0.scheme == "https" || $0.scheme == "http" ? $0 : nil }
        let hint = call.getString("hint") ?? "Sign in if it asks. Open the page with your homework or grades, then tap Add to TaskM."
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("TaskM isn’t ready yet."); return }
            let browser = SchoolBrowser(url: url, hint: hint)
            browser.onFinish = { call.resolve($0) }
            let nav = UINavigationController(rootViewController: browser)
            nav.modalPresentationStyle = .fullScreen
            nav.isToolbarHidden = true
            (host.presentedViewController ?? host).present(nav, animated: true)
        }
    }

    /// Opens a page in the hidden reader. Resolves {url, title} once it has loaded (or after 20 seconds).
    @objc func visit(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), url.scheme == "https" else {
            call.reject("That isn’t a web address.")
            return
        }
        DispatchQueue.main.async {
            let wv = self.readerView()
            self.loadCall?.resolve(self.readerInfo())
            self.loadCall = call
            self.collector.reset()
            wv.load(URLRequest(url: url))
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                guard let self = self, self.loadCall === call else { return }
                self.loadCall = nil
                call.resolve(self.readerInfo())
            }
        }
    }

    /// What the hidden reader shows right now: {url, title, frames: [{url, text}]}
    @objc func frames(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let wv = self.reader else { call.reject("Nothing is open."); return }
            self.collector.read(wv) { frames in
                var info = self.readerInfo()
                info["frames"] = frames
                call.resolve(info)
            }
        }
    }

    /// Runs a script in the hidden reader's page, like clicking Teams' "use the web app instead" link.
    @objc func run(_ call: CAPPluginCall) {
        let code = call.getString("code") ?? ""
        DispatchQueue.main.async {
            guard let wv = self.reader else { call.resolve(); return }
            wv.evaluateJavaScript(code) { _, _ in call.resolve() }
        }
    }

    @objc func closeReader(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.reader?.stopLoading()
            self.reader?.removeFromSuperview()
            self.reader = nil
            self.collector.reset()
            self.loadCall?.resolve(self.readerInfo())
            self.loadCall = nil
            call.resolve()
        }
    }

    /// The hidden reader sits behind TaskM's screen, so the student never sees it.
    private func readerView() -> WKWebView {
        if let r = reader { return r }
        let wv = schoolWebView(collector)
        wv.navigationDelegate = self
        wv.isUserInteractionEnabled = false
        if let main = bridge?.viewController?.view, let holder = main.window ?? main.superview {
            wv.frame = holder.bounds
            wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            holder.insertSubview(wv, at: 0)
        }
        reader = wv
        return wv
    }

    private func readerInfo() -> [String: Any] {
        ["url": reader?.url?.absoluteString ?? "", "title": reader?.title ?? ""]
    }

    private func loaded(_ webView: WKWebView) {
        guard webView === reader, let call = loadCall else { return }
        loadCall = nil
        call.resolve(readerInfo())
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded(webView) }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loaded(webView) }
    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loaded(webView) }
}

// MARK: - TaskM's browser

final class SchoolBrowser: UIViewController, WKNavigationDelegate, WKUIDelegate, UITextFieldDelegate {
    var onFinish: (([String: Any]) -> Void)?

    private let startURL: URL?
    private let hint: String
    private let collector = FrameCollector()
    private var webView: WKWebView!
    private let address = UITextField()
    private let addButton = UIButton(type: .system)
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var watchers: [NSKeyValueObservation] = []

    init(url: URL?, hint: String) {
        startURL = url
        self.hint = hint
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        webView = schoolWebView(collector)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        address.borderStyle = .roundedRect
        address.placeholder = "Type a school website"
        address.keyboardType = .URL
        address.autocapitalizationType = .none
        address.autocorrectionType = .no
        address.returnKeyType = .go
        address.clearButtonMode = .whileEditing
        address.textAlignment = .center
        address.font = .preferredFont(forTextStyle: .subheadline)
        address.delegate = self
        address.frame = CGRect(x: 0, y: 0, width: 600, height: 34)
        navigationItem.titleView = address
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in
            self?.finish(["action": "close"])
        })
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(image: UIImage(systemName: "arrow.clockwise"), primaryAction: UIAction { [weak self] _ in self?.webView.reload() }),
            UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), primaryAction: UIAction { [weak self] _ in
                if self?.webView.canGoBack == true { self?.webView.goBack() }
            }),
        ]

        let tip = UILabel()
        tip.text = hint
        tip.font = .preferredFont(forTextStyle: .footnote)
        tip.adjustsFontForContentSizeCategory = true
        tip.textColor = .secondaryLabel
        tip.numberOfLines = 0
        tip.textAlignment = .center

        var cfg = UIButton.Configuration.filled()
        cfg.title = "Add to TaskM"
        cfg.image = UIImage(systemName: "plus.circle.fill")
        cfg.imagePadding = 8
        cfg.baseBackgroundColor = UIColor(red: 0x50 / 255, green: 0x48 / 255, blue: 0xe5 / 255, alpha: 1)
        cfg.cornerStyle = .large
        cfg.buttonSize = .large
        addButton.configuration = cfg
        addButton.addTarget(self, action: #selector(add), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [tip, addButton])
        stack.axis = .vertical
        stack.spacing = 10
        let bar = UIView()
        bar.backgroundColor = .secondarySystemBackground
        bar.addSubview(stack)

        for v in [webView!, bar, stack, progress] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
        view.addSubview(webView)
        view.addSubview(bar)
        view.addSubview(progress)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bar.topAnchor),
            progress.topAnchor.constraint(equalTo: safe.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.topAnchor.constraint(equalTo: bar.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -8),
        ])

        watchers.append(webView.observe(\.url) { [weak self] _, _ in self?.showAddress() })
        watchers.append(webView.observe(\.estimatedProgress) { [weak self] wv, _ in
            self?.progress.setProgress(Float(wv.estimatedProgress), animated: true)
            self?.progress.isHidden = wv.estimatedProgress >= 1
        })
        if let u = startURL { webView.load(URLRequest(url: u)) }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if startURL == nil && webView.url == nil { address.becomeFirstResponder() }
    }

    private func showAddress() {
        if !address.isEditing { address.text = webView.url?.host ?? "" }
    }

    func textFieldDidBeginEditing(_ field: UITextField) {
        field.text = webView.url?.absoluteString ?? field.text
        field.textAlignment = .natural
        DispatchQueue.main.async { field.selectAll(nil) }
    }

    func textFieldDidEndEditing(_ field: UITextField) {
        field.textAlignment = .center
        showAddress()
    }

    func textFieldShouldReturn(_ field: UITextField) -> Bool {
        let s = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        field.resignFirstResponder()
        if s.isEmpty { return false }
        var url: URL?
        if s.contains("://") {
            url = URL(string: s)
        } else if s.contains(".") && !s.contains(" ") {
            url = URL(string: "https://" + s)
        } else {
            var q = URLComponents(string: "https://www.bing.com/search")
            q?.queryItems = [URLQueryItem(name: "q", value: s)]
            url = q?.url
        }
        if let u = url { webView.load(URLRequest(url: u)) }
        return false
    }

    @objc private func add() {
        guard let url = webView.url, url.scheme == "https" || url.scheme == "http" else {
            address.becomeFirstResponder()
            return
        }
        addButton.isEnabled = false
        addButton.configuration?.showsActivityIndicator = true
        addButton.configuration?.title = "Reading this page…"
        collector.read(webView) { [weak self] frames in
            guard let self = self else { return }
            self.finish(["action": "add", "url": url.absoluteString, "title": self.webView.title ?? "", "frames": frames])
        }
    }

    private func finish(_ result: [String: Any]) {
        guard let done = onFinish else { return }
        onFinish = nil
        webView.stopLoading()
        dismiss(animated: true) { done(result) }
    }

    // A new page in the main frame: forget the old page's frames
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { collector.reset() }

    // Links that open apps (msteams:, onenote:, mailto:) stay in TaskM's browser instead
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = action.request.url?.scheme?.lowercased() ?? ""
        decisionHandler(["https", "http", "about", "blob", "data"].contains(scheme) ? .allow : .cancel)
    }

    // Links that open a new window open here
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil { webView.load(action.request) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        guard presentedViewController == nil else { completionHandler(); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        guard presentedViewController == nil else { completionHandler(false); return }
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}
