import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassTransform;
import java.lang.classfile.instruction.InvokeInstruction;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;

/**
 * Test-only Java agent for the standalone UniFi Network Application.
 *
 * The Network app accepts API keys only via its UniFi OS authenticator, which
 * trusts an `X-ApiKeyId` header from UniFi OS's proxy. The Integration API can be
 * pointed at it with `-Dintegration.api.force.using.ucore.authentication=true`,
 * but the authenticator itself still bails out unless `unifi.core.enabled` is
 * set, and setting that globally turns on every UniFi OS integration, which the
 * standalone build can't run. This agent makes only the authenticator's check
 * return true, leaving everything else in standalone mode.
 *
 * Class and method names are obfuscated and specific to Network 10.6.109.
 */
public final class ApiKeyAgent {
	private static final String AUTHENTICATOR = "com/ubnt/net/g/oViVvFSgD";
	private static final String CORE_FLAG_OWNER = "com/ubnt/g/aoUDgXMlCqEvTSIrOtq";
	private static final String CORE_FLAG_METHOD = "WBZgUYGO";

	public static void premain(String args, Instrumentation instrumentation) {
		instrumentation.addTransformer(new ClassFileTransformer() {
			@Override
			public byte[] transform(
					ClassLoader loader, String name, Class<?> redefined, ProtectionDomain domain, byte[] bytes) {
				if (!AUTHENTICATOR.equals(name)) return null;
				var classFile = ClassFile.of();
				var patched = classFile.transformClass(
						classFile.parse(bytes),
						ClassTransform.transformingMethodBodies(
								method -> true,
								(code, element) -> {
									if (element instanceof InvokeInstruction call
											&& call.owner().asInternalName().equals(CORE_FLAG_OWNER)
											&& call.name().equalsString(CORE_FLAG_METHOD)) {
										code.iconst_1();
									} else {
										code.with(element);
									}
								}));
				System.err.println("[api-key-agent] patched " + name);
				return patched;
			}
		});
	}
}
