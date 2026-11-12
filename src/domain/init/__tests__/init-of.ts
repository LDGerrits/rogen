import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { ProcessService } from "../../../platform/process/process-service.js";
import { PromptService } from "../../../platform/prompt/prompt-service.js";
import { AgentRules } from "../agent/agent-rules.js";
import { CodeFinder } from "../code-finder.js";
import { GitRepository } from "../git-repository.js";
import { InitQuestions } from "../init-questions.js";
import { InitChoices } from "../init-service.js";
import { InitDirectory } from "../init-directory.js";
import { ProcessedFolder } from "../processed-folder.js";
import { ProjectSetup } from "../project-setup.js";
import { ReviewPrompts } from "../review-prompts.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { IndexService } from "../../../platform/fs/index-service.js";
import { SyncDescriptor } from "../../../platform/instantiation/sync-descriptor.js";
import { LifecycleService } from "../../../platform/lifecycle/lifecycle-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { ConfigService } from "../../config/config-service.js";
import { CoreToolLocator } from "../../toolchain/core-tool-locator.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { ToolLocator } from "../../toolchain/tool-locator.js";
import { ToolchainService } from "../../toolchain/toolchain-service.js";
import { CoreWriteService } from "../../write/core-write-service.js";
import { WriteService } from "../../write/write-service.js";
import { CoreInitService } from "../core-init-service.js";

/** The init classes built as Rogen builds them, over the fakes a test hands them. */
export const questionsOf = (
	prompt: PromptService,
	interactive: boolean,
	choices: InitChoices = {},
	review?: ReviewPrompts
): InitQuestions =>
	instantiationOf([PromptService, prompt]).createInstance(
		InitQuestions,
		interactive,
		choices,
		review
	);

export const reviewOf = (prompt: PromptService): ReviewPrompts =>
	instantiationOf([PromptService, prompt]).createInstance(ReviewPrompts);

export const setupOf = (
	directory: InitDirectory,
	questions: InitQuestions,
	fs: FileSystemService
): ProjectSetup =>
	instantiationOf([FileSystemService, fs]).createInstance(
		ProjectSetup,
		directory,
		questions
	);

export const codeFinderOf = (fs: FileSystemService): CodeFinder =>
	instantiationOf([FileSystemService, fs]).createInstance(CodeFinder);

export const processedFolderOf = (
	fs: FileSystemService,
	directory: string
): ProcessedFolder =>
	instantiationOf([FileSystemService, fs]).createInstance(
		ProcessedFolder,
		directory
	);

export const gitOf = (
	processes: ProcessService,
	fs: FileSystemService
): GitRepository =>
	instantiationOf(
		[ProcessService, processes],
		[FileSystemService, fs]
	).createInstance(GitRepository);

export const agentRulesOf = (
	fs: FileSystemService,
	git: GitRepository
): AgentRules =>
	instantiationOf([FileSystemService, fs]).createInstance(AgentRules, git);

/** The init service over the fakes of a test, with the real services it builds on. */
export const initServiceOf = (
	fs: FileSystemService,
	prompt: PromptService,
	environment: EnvironmentService,
	processes: ProcessService,
	config: ConfigService,
	lifecycle: LifecycleService = new MockLifecycleService()
): CoreInitService =>
	instantiationOf(
		[FileSystemService, fs],
		[PromptService, prompt],
		[EnvironmentService, environment],
		[ProcessService, processes],
		[ConfigService, config],
		[LifecycleService, lifecycle],
		[IndexService, new SyncDescriptor(CoreIndexService)],
		[ToolchainService, new SyncDescriptor(CoreToolchainService)],
		[ToolLocator, new SyncDescriptor(CoreToolLocator)],
		[WriteService, new SyncDescriptor(CoreWriteService)]
	).createInstance(CoreInitService);
